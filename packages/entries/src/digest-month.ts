import { spawn } from "node:child_process";
import {
  CURRENT_MONTH_DIGEST_SCHEMA_VERSION,
  type DayHelpfulness, type DayOutcome, type MonthDigest, type WeekDigest,
} from "./types.js";
import {
  DIGEST_MONTH_SYSTEM_PROMPT,
  MonthDigestResponseSchema,
  buildMonthDigestUserPrompt,
} from "./prompts/digest-month.js";
import type { CallLLM, EnrichUsage, LLMResponse } from "./enrich.js";
import { computeCostUsd } from "./enrich.js";

function prettyProject(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

/** ISO Mondays in the given year-month, in chronological order. */
export function mondaysInMonth(yearMonth: string): string[] {
  const [yStr, mStr] = yearMonth.split("-");
  const y = Number(yStr), m = Number(mStr);
  const out: string[] = [];
  const firstDay = new Date(y, m - 1, 1);
  // Find the first Monday on or after the 1st.
  const offset = (8 - firstDay.getDay()) % 7;
  const firstMonday = new Date(y, m - 1, 1 + offset);
  const cursor = new Date(firstMonday);
  while (cursor.getMonth() === m - 1) {
    out.push(toLocalDateString(cursor));
    cursor.setDate(cursor.getDate() + 7);
  }
  return out;
}

function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function buildDeterministicMonthDigest(
  yearMonth: string,
  weekDigests: WeekDigest[],
): MonthDigest {
  const mondays = mondaysInMonth(yearMonth);
  const byMonday = new Map<string, WeekDigest>();
  for (const w of weekDigests) byMonday.set(w.key, w);

  const agent_min_total = weekDigests.reduce((sum, w) => sum + w.agent_min_total, 0);

  const byProject = new Map<string, { agent_min: number; shipped_count: number }>();
  for (const w of weekDigests) {
    for (const p of w.projects) {
      const cur = byProject.get(p.name) ?? { agent_min: 0, shipped_count: 0 };
      cur.agent_min += p.agent_min;
      cur.shipped_count += p.shipped_count;
      byProject.set(p.name, cur);
    }
  }
  const projects = [...byProject.entries()]
    .sort((a, b) => b[1].agent_min - a[1].agent_min)
    .map(([name, v]) => ({
      name,
      display_name: prettyProject(name),
      agent_min: v.agent_min,
      share_pct: agent_min_total > 0 ? (v.agent_min / agent_min_total) * 100 : 0,
      shipped_count: v.shipped_count,
    }));

  const shipped: MonthDigest["shipped"] = [];
  for (const w of weekDigests) {
    for (const s of w.shipped) {
      shipped.push({ title: s.title, project: s.project, date: s.date, session_id: s.session_id });
    }
  }

  const outcome_mix: Partial<Record<DayOutcome, number>> = {};
  for (const w of weekDigests) {
    for (const [k, v] of Object.entries(w.outcome_mix) as [DayOutcome, number][]) {
      outcome_mix[k] = (outcome_mix[k] ?? 0) + v;
    }
  }

  const helpfulness_by_week: MonthDigest["helpfulness_by_week"] = mondays.map(week_start => {
    const w = byMonday.get(week_start);
    const helpfulness: DayHelpfulness = w
      ? (w.helpfulness_sparkline.find(h => h !== null) ?? null)
      : null;
    return { week_start, helpfulness };
  });

  const flagCounts = new Map<string, number>();
  for (const w of weekDigests) {
    for (const f of w.top_flags) {
      flagCounts.set(f.flag, (flagCounts.get(f.flag) ?? 0) + f.count);
    }
  }
  const top_flags = [...flagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([flag, count]) => ({ flag, count }));

  const goalMinutes = new Map<string, number>();
  for (const w of weekDigests) {
    for (const g of w.top_goal_categories) {
      goalMinutes.set(g.category, (goalMinutes.get(g.category) ?? 0) + g.minutes);
    }
  }
  const top_goal_categories = [...goalMinutes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([category, minutes]) => ({ category, minutes }));

  let concurrency_peak_week: MonthDigest["concurrency_peak_week"] = null;
  for (const w of weekDigests) {
    const peak = w.concurrency_peak_day?.peak ?? 0;
    if (peak > 0) {
      if (!concurrency_peak_week || peak > concurrency_peak_week.peak) {
        concurrency_peak_week = { week_start: w.key, peak };
      }
    }
  }

  const [yStr, mStr] = yearMonth.split("-");
  const y = Number(yStr), m = Number(mStr);
  const firstDay = `${yearMonth}-01`;
  const lastDay = toLocalDateString(new Date(y, m, 0));
  const window = { start: `${firstDay}T00:00:00`, end: `${lastDay}T23:59:59` };

  return {
    version: CURRENT_MONTH_DIGEST_SCHEMA_VERSION,
    scope: "month",
    key: yearMonth,
    window,
    week_refs: weekDigests.map(w => w.key).sort(),
    generated_at: new Date().toISOString(),
    is_live: false,
    model: null,
    cost_usd: null,
    agent_min_total,
    projects,
    shipped,
    outcome_mix,
    helpfulness_by_week,
    top_flags,
    top_goal_categories,
    concurrency_peak_week,
    headline: null,
    trajectory: null,
    standout_weeks: null,
    friction_themes: null,
    suggestion: null,
  };
}

// ─── Generator (LLM narrative) ───────────────────────────────────────────

export type GenerateMonthOptions = {
  model?: string;
  callLLM?: CallLLM;
  onProgress?: (info: { bytes: number; elapsedMs: number }) => void;
};

export type GenerateMonthResult = {
  digest: MonthDigest;
  usage: EnrichUsage | null;
};

const DEFAULT_MODEL = "sonnet";

async function defaultCallLLMMonth(args: {
  model: string;
  userPrompt: string;
  reminder?: string;
  onProgress?: (info: { bytes: number; elapsedMs: number }) => void;
}): Promise<LLMResponse> {
  return new Promise((resolve, reject) => {
    const claudeArgs = [
      "-p", "--output-format", "stream-json", "--verbose",
      "--model", args.model, "--tools", "",
      "--disable-slash-commands", "--no-session-persistence",
      "--setting-sources", "",
      "--append-system-prompt", DIGEST_MONTH_SYSTEM_PROMPT,
    ];
    const proc = spawn("claude", claudeArgs, { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env } });
    const stdinPayload = args.reminder
      ? `${args.userPrompt}\n\n---\n\n${args.reminder}`
      : args.userPrompt;
    proc.stdin.write(stdinPayload);
    proc.stdin.end();

    let buffer = "", inputTokens = 0, outputTokens = 0, modelUsed = args.model, stderr = "";
    const startMs = Date.now();
    let lastReportedKb = -1;
    proc.stdout.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split("\n")) {
        const t = line.trim();
        if (!t) continue;
        try {
          const obj = JSON.parse(t) as Record<string, unknown>;
          if (obj.type === "assistant") {
            const msg = obj.message as Record<string, unknown> | undefined;
            const content = msg?.content as Array<Record<string, unknown>> | undefined;
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === "text" && typeof block.text === "string") {
                  buffer += block.text;
                  if (args.onProgress) {
                    const kb = Math.floor(buffer.length / 1024);
                    if (kb > lastReportedKb) {
                      lastReportedKb = kb;
                      args.onProgress({ bytes: buffer.length, elapsedMs: Date.now() - startMs });
                    }
                  }
                }
              }
            }
            const mm = (msg as { model?: string } | undefined)?.model;
            if (mm) modelUsed = mm;
          }
          if (obj.type === "result") {
            const usage = obj.usage as { input_tokens?: number; output_tokens?: number } | undefined;
            if (usage) {
              inputTokens = usage.input_tokens ?? 0;
              outputTokens = usage.output_tokens ?? 0;
            }
          }
        } catch { /* skip */ }
      }
    });
    proc.stderr.on("data", (c: Buffer) => { stderr += c.toString("utf8"); });
    proc.on("close", code => {
      if (code !== 0 && !buffer) {
        reject(new Error(`claude exited ${code}: ${stderr.trim().slice(0, 300)}`));
        return;
      }
      resolve({ content: buffer, input_tokens: inputTokens, output_tokens: outputTokens, model: modelUsed });
    });
    proc.on("error", err => reject(new Error(`Failed to spawn claude: ${err.message}`)));
  });
}

function parseAndValidate(content: string) {
  const stripped = content.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```\s*$/, "").trim();
  try {
    const parsed = JSON.parse(stripped);
    const r = MonthDigestResponseSchema.safeParse(parsed);
    if (r.success) return { ok: true as const, value: r.data };
    return { ok: false as const, error: "schema: " + r.error.message };
  } catch (e) {
    return { ok: false as const, error: "json: " + (e as Error).message };
  }
}

export async function generateMonthDigest(
  yearMonth: string,
  weekDigests: WeekDigest[],
  opts: GenerateMonthOptions = {},
): Promise<GenerateMonthResult> {
  const base = buildDeterministicMonthDigest(yearMonth, weekDigests);
  const enrichedWeeks = weekDigests.filter(w => w.headline !== null);
  if (enrichedWeeks.length < 2) return { digest: base, usage: null };

  const model = opts.model ?? DEFAULT_MODEL;
  const callLLM = opts.callLLM ?? defaultCallLLMMonth;
  const userPrompt = buildMonthDigestUserPrompt(base, weekDigests);
  let inT = 0, outT = 0;
  let lastModel = model;

  try {
    const r1 = await callLLM({ model, userPrompt, onProgress: opts.onProgress });
    inT += r1.input_tokens; outT += r1.output_tokens; lastModel = r1.model;
    const v1 = parseAndValidate(r1.content);
    if (v1.ok) {
      return {
        digest: {
          ...base,
          model: lastModel,
          cost_usd: computeCostUsd(lastModel, inT, outT),
          headline: v1.value.headline,
          trajectory: v1.value.trajectory,
          standout_weeks: v1.value.standout_weeks,
          friction_themes: v1.value.friction_themes,
          suggestion: v1.value.suggestion,
        },
        usage: { input_tokens: inT, output_tokens: outT },
      };
    }

    const r2 = await callLLM({
      model, userPrompt,
      reminder: "Your previous response was not valid JSON or did not match the required schema. Return ONLY the JSON object with the five required fields — no prose, no code fence.",
      onProgress: opts.onProgress,
    });
    inT += r2.input_tokens; outT += r2.output_tokens; lastModel = r2.model;
    const v2 = parseAndValidate(r2.content);
    if (v2.ok) {
      return {
        digest: {
          ...base,
          model: lastModel,
          cost_usd: computeCostUsd(lastModel, inT, outT),
          headline: v2.value.headline,
          trajectory: v2.value.trajectory,
          standout_weeks: v2.value.standout_weeks,
          friction_themes: v2.value.friction_themes,
          suggestion: v2.value.suggestion,
        },
        usage: { input_tokens: inT, output_tokens: outT },
      };
    }

    console.warn(`[digest-month] ${yearMonth}: LLM response failed validation after retry (${v2.error})`);
    return { digest: base, usage: { input_tokens: inT, output_tokens: outT } };
  } catch (err) {
    console.warn(`[digest-month] ${yearMonth}: LLM invocation failed (${(err as Error).message})`);
    return { digest: base, usage: inT > 0 ? { input_tokens: inT, output_tokens: outT } : null };
  }
}
