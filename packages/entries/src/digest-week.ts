import { spawn } from "node:child_process";
import {
  CURRENT_WEEK_DIGEST_SCHEMA_VERSION,
  type DayDigest, type DayHelpfulness, type DayOutcome, type Entry, type WeekDigest,
} from "./types.js";
import {
  DIGEST_WEEK_SYSTEM_PROMPT,
  WeekDigestResponseSchema,
  buildWeekDigestUserPrompt,
} from "./prompts/digest-week.js";
import type { CallLLM, EnrichUsage, LLMResponse } from "./enrich.js";
import { computeCostUsd } from "./enrich.js";

function prettyProject(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

/** Mon-Sun array of dates from a Monday key. Mutates nothing. */
export function weekDates(monday: string): string[] {
  const start = new Date(`${monday}T00:00:00`);
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    out.push(toLocalDateString(d));
  }
  return out;
}

function toLocalDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export type BuildDeterministicWeekOptions = {
  /** Optional entries — needed for longest_run + hours_distribution.
   *  When omitted both fields are null/empty and the renderer hides those slices. */
  entries?: Entry[];
};

export function buildDeterministicWeekDigest(
  monday: string,
  dayDigests: DayDigest[],
  opts: BuildDeterministicWeekOptions = {},
): WeekDigest {
  const dates = weekDates(monday);
  const byDate = new Map<string, DayDigest>();
  for (const d of dayDigests) byDate.set(d.key, d);

  const agent_min_total = dayDigests.reduce((sum, d) => sum + d.agent_min, 0);

  // Aggregate per-project across all day digests.
  const byProject = new Map<string, { agent_min: number; shipped_count: number }>();
  for (const dd of dayDigests) {
    for (const p of dd.projects) {
      const cur = byProject.get(p.name) ?? { agent_min: 0, shipped_count: 0 };
      cur.agent_min += (p.share_pct / 100) * dd.agent_min;
      byProject.set(p.name, cur);
    }
  }
  for (const dd of dayDigests) {
    for (const s of dd.shipped) {
      // s.project is already display_name; map back to canonical via lookup
      // by matching display_name in dd.projects. If not found, count under the
      // display_name as a synthetic key (rare — only when shipping outside
      // any tracked project).
      const match = dd.projects.find(p => p.display_name === s.project);
      const key = match ? match.name : s.project;
      const cur = byProject.get(key) ?? { agent_min: 0, shipped_count: 0 };
      cur.shipped_count += 1;
      byProject.set(key, cur);
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
      description: null as string | null,
    }));

  const shipped: WeekDigest["shipped"] = [];
  for (const dd of dayDigests) {
    for (const s of dd.shipped) {
      shipped.push({ title: s.title, project: s.project, date: dd.key, session_id: s.session_id });
    }
  }

  const outcome_mix: Partial<Record<DayOutcome, number>> = {};
  for (const dd of dayDigests) {
    outcome_mix[dd.outcome_day] = (outcome_mix[dd.outcome_day] ?? 0) + 1;
  }

  const helpfulness_sparkline: DayHelpfulness[] = dates.map(date => {
    const dd = byDate.get(date);
    return dd ? dd.helpfulness_day : null;
  });

  const flagCounts = new Map<string, number>();
  for (const dd of dayDigests) {
    for (const f of dd.top_flags) {
      flagCounts.set(f.flag, (flagCounts.get(f.flag) ?? 0) + f.count);
    }
  }
  const top_flags = [...flagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([flag, count]) => ({ flag, count }));

  const goalMinutes = new Map<string, number>();
  for (const dd of dayDigests) {
    for (const g of dd.top_goal_categories) {
      goalMinutes.set(g.category, (goalMinutes.get(g.category) ?? 0) + g.minutes);
    }
  }
  const top_goal_categories = [...goalMinutes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([category, minutes]) => ({ category, minutes }));

  let concurrency_peak_day: WeekDigest["concurrency_peak_day"] = null;
  for (const dd of dayDigests) {
    if (dd.concurrency_peak > 0) {
      if (!concurrency_peak_day || dd.concurrency_peak > concurrency_peak_day.peak) {
        concurrency_peak_day = { date: dd.key, peak: dd.concurrency_peak };
      }
    }
  }

  // ── days_active strip + busiest_day ──
  const days_active: WeekDigest["days_active"] = dayDigests
    .filter(d => d.agent_min > 0)
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(d => ({
      date: d.key,
      agent_min: d.agent_min,
      shipped_count: d.shipped.length,
      outcome_day: d.outcome_day,
      helpfulness_day: d.helpfulness_day,
    }));

  let busiest_day: WeekDigest["busiest_day"] = null;
  for (const d of days_active) {
    if (!busiest_day || d.agent_min > busiest_day.agent_min) {
      busiest_day = { date: d.date, agent_min: d.agent_min, shipped_count: d.shipped_count };
    }
  }

  // ── longest_run + hours_distribution from entries ──
  let longest_run: WeekDigest["longest_run"] = null;
  const hours_distribution = new Array<number>(24).fill(0);
  const entries = opts.entries ?? [];
  for (const e of entries) {
    if (!longest_run || e.numbers.active_min > longest_run.active_min) {
      longest_run = {
        session_id: e.session_id,
        date: e.local_day,
        project_display: prettyProject(e.project),
        active_min: e.numbers.active_min,
      };
    }
    const startMs = Date.parse(e.start_iso);
    if (!Number.isNaN(startMs)) {
      const hour = new Date(startMs).getHours();
      hours_distribution[hour] = (hours_distribution[hour] ?? 0) + e.numbers.active_min;
    }
  }

  const sunday = dates[6]!;
  const window = { start: `${monday}T00:00:00`, end: `${sunday}T23:59:59` };

  return {
    version: CURRENT_WEEK_DIGEST_SCHEMA_VERSION,
    scope: "week",
    key: monday,
    window,
    day_refs: dayDigests.map(d => d.key).sort(),
    generated_at: new Date().toISOString(),
    is_live: false,
    model: null,
    cost_usd: null,
    agent_min_total,
    projects,
    shipped,
    outcome_mix,
    helpfulness_sparkline,
    top_flags,
    top_goal_categories,
    concurrency_peak_day,
    days_active,
    busiest_day,
    longest_run,
    hours_distribution,
    headline: null,
    key_pattern: null,
    trajectory: null,
    standout_days: null,
    recurring_themes: null,
    outcome_correlations: null,
    friction_categories: null,
    suggestions: null,
    on_the_horizon: null,
    fun_ending: null,
  };
}

// ─── Generator (LLM narrative) ───────────────────────────────────────────

export type GenerateWeekOptions = {
  model?: string;
  callLLM?: CallLLM;
  onProgress?: (info: { bytes: number; elapsedMs: number }) => void;
  /** Entries for the week — used to compute longest_run + hours_distribution. */
  entries?: Entry[];
};

export type GenerateWeekResult = {
  digest: WeekDigest;
  usage: EnrichUsage | null;
};

const DEFAULT_MODEL = "sonnet";

async function defaultCallLLMWeek(args: {
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
      "--append-system-prompt", DIGEST_WEEK_SYSTEM_PROMPT,
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
    const r = WeekDigestResponseSchema.safeParse(parsed);
    if (r.success) return { ok: true as const, value: r.data };
    return { ok: false as const, error: "schema: " + r.error.message };
  } catch (e) {
    return { ok: false as const, error: "json: " + (e as Error).message };
  }
}

export async function generateWeekDigest(
  monday: string,
  dayDigests: DayDigest[],
  opts: GenerateWeekOptions = {},
): Promise<GenerateWeekResult> {
  const base = buildDeterministicWeekDigest(monday, dayDigests, { entries: opts.entries });
  // Need at least 2 day digests with a real outcome to produce useful narrative.
  const enrichedDays = dayDigests.filter(d => d.outcome_day !== "idle" && d.outcome_day !== "trivial");
  if (enrichedDays.length < 2) return { digest: base, usage: null };

  const model = opts.model ?? DEFAULT_MODEL;
  const callLLM = opts.callLLM ?? defaultCallLLMWeek;
  const userPrompt = buildWeekDigestUserPrompt(base, dayDigests);
  let inT = 0, outT = 0;
  let lastModel = model;

  function mergeNarrative(value: import("./prompts/digest-week.js").WeekDigestResponse): WeekDigest {
    const projectsByName = new Map(base.projects.map(p => [p.display_name, p]));
    const enrichedProjects = base.projects.map(p => {
      const match = value.project_areas.find(pa => pa.display_name === p.display_name);
      return match ? { ...p, description: match.description } : p;
    });
    void projectsByName;
    return {
      ...base,
      projects: enrichedProjects,
      model: lastModel,
      cost_usd: computeCostUsd(lastModel, inT, outT),
      headline: value.headline,
      key_pattern: value.key_pattern,
      trajectory: value.trajectory,
      standout_days: value.standout_days,
      recurring_themes: value.recurring_themes,
      outcome_correlations: value.outcome_correlations,
      friction_categories: value.friction_categories,
      suggestions: value.suggestions,
      on_the_horizon: value.on_the_horizon,
      fun_ending: value.fun_ending,
    };
  }

  try {
    const r1 = await callLLM({ model, userPrompt, onProgress: opts.onProgress });
    inT += r1.input_tokens; outT += r1.output_tokens; lastModel = r1.model;
    const v1 = parseAndValidate(r1.content);
    if (v1.ok) {
      return { digest: mergeNarrative(v1.value), usage: { input_tokens: inT, output_tokens: outT } };
    }

    const r2 = await callLLM({
      model, userPrompt,
      reminder: "Your previous response was not valid JSON or did not match the required schema. Return ONLY the JSON object with all required fields — no prose, no code fence.",
      onProgress: opts.onProgress,
    });
    inT += r2.input_tokens; outT += r2.output_tokens; lastModel = r2.model;
    const v2 = parseAndValidate(r2.content);
    if (v2.ok) {
      return { digest: mergeNarrative(v2.value), usage: { input_tokens: inT, output_tokens: outT } };
    }

    console.warn(`[digest-week] ${monday}: LLM response failed validation after retry (${v2.error})`);
    return { digest: base, usage: { input_tokens: inT, output_tokens: outT } };
  } catch (err) {
    console.warn(`[digest-week] ${monday}: LLM invocation failed (${(err as Error).message})`);
    return { digest: base, usage: inT > 0 ? { input_tokens: inT, output_tokens: outT } : null };
  }
}
