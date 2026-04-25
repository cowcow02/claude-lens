import { spawn } from "node:child_process";
import {
  CURRENT_DAY_DIGEST_SCHEMA_VERSION,
  type DayDigest, type DayHelpfulness, type DayOutcome, type Entry,
} from "./types.js";
import {
  DIGEST_DAY_SYSTEM_PROMPT,
  DayDigestResponseSchema,
  buildDigestUserPrompt,
} from "./prompts/digest-day.js";
import type { CallLLM, EnrichUsage, LLMResponse } from "./enrich.js";
import { computeCostUsd } from "./enrich.js";

function prettyProjectName(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

/** Day-level outcome: any-of priority. Prevents a day with one shipped PR from
 *  reading as "trivial" just because other sessions were warmups. */
function rollupOutcomeDay(entries: Entry[]): DayOutcome {
  if (entries.length === 0) return "idle";
  const outcomes = new Set(entries.map(e => e.enrichment.outcome).filter(Boolean));
  if (outcomes.has("shipped")) return "shipped";
  if (outcomes.has("partial")) return "partial";
  if (outcomes.has("blocked")) return "blocked";
  if (outcomes.has("exploratory")) return "exploratory";
  return "trivial";
}

/** Day-level helpfulness: mode across enriched entries, tiebreak toward worse
 *  signal so regressions surface early in weekly aggregation. */
function rollupHelpfulnessDay(entries: Entry[]): DayHelpfulness {
  const counts = new Map<Exclude<DayHelpfulness, null>, number>();
  for (const e of entries) {
    const h = e.enrichment.claude_helpfulness;
    if (!h) continue;
    counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  // Worse-signal tiebreak order.
  const severity: Array<Exclude<DayHelpfulness, null>> = ["unhelpful", "neutral", "helpful", "essential"];
  let best: Exclude<DayHelpfulness, null> | null = null;
  let bestCount = 0;
  for (const level of severity) {
    const c = counts.get(level) ?? 0;
    if (c > bestCount) { best = level; bestCount = c; }
  }
  return best;
}

export function buildDeterministicDigest(
  date: string,
  entries: Entry[],
  opts: { concurrencyPeak?: number } = {},
): DayDigest {
  const agent_min = entries.reduce((sum, e) => sum + e.numbers.active_min, 0);

  const byProject = new Map<string, { minutes: number; entry_count: number }>();
  for (const e of entries) {
    const prev = byProject.get(e.project) ?? { minutes: 0, entry_count: 0 };
    prev.minutes += e.numbers.active_min;
    prev.entry_count += 1;
    byProject.set(e.project, prev);
  }
  const projects = [...byProject.entries()]
    .sort((a, b) => b[1].minutes - a[1].minutes)
    .map(([name, v]) => ({
      name,
      display_name: prettyProjectName(name),
      share_pct: agent_min > 0 ? (v.minutes / agent_min) * 100 : 0,
      entry_count: v.entry_count,
    }));

  const shipped = entries.flatMap(e =>
    e.pr_titles.map(title => ({
      title,
      project: prettyProjectName(e.project),
      session_id: e.session_id,
    })),
  );

  const flagCounts = new Map<string, number>();
  for (const e of entries) {
    for (const f of e.flags) {
      flagCounts.set(f, (flagCounts.get(f) ?? 0) + 1);
    }
  }
  const top_flags = [...flagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([flag, count]) => ({ flag, count }));

  const goalMinutes = new Map<string, number>();
  for (const e of entries) {
    if (e.enrichment.status !== "done") continue;
    for (const [g, min] of Object.entries(e.enrichment.goal_categories ?? {})) {
      goalMinutes.set(g, (goalMinutes.get(g) ?? 0) + (min ?? 0));
    }
  }
  const top_goal_categories = [...goalMinutes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([category, minutes]) => ({ category, minutes }));

  const window = {
    start: `${date}T00:00:00`,
    end: `${date}T23:59:59`,
  };

  return {
    version: CURRENT_DAY_DIGEST_SCHEMA_VERSION,
    scope: "day",
    key: date,
    window,
    entry_refs: entries.map(e => `${e.session_id}__${e.local_day}`),
    generated_at: new Date().toISOString(),
    is_live: false,
    model: null,
    cost_usd: null,
    projects,
    shipped,
    top_flags,
    top_goal_categories,
    concurrency_peak: opts.concurrencyPeak ?? 0,
    agent_min,
    outcome_day: rollupOutcomeDay(entries),
    helpfulness_day: rollupHelpfulnessDay(entries),
    headline: null,
    narrative: null,
    what_went_well: null,
    what_hit_friction: null,
    suggestion: null,
  };
}

// ─── Generator (LLM narrative layer) ──────────────────────────────────────

export type GenerateOptions = {
  model?: string;
  callLLM?: CallLLM;
  concurrencyPeak?: number;
  /** Optional char-count progress from the claude -p synth call. */
  onProgress?: (info: { bytes: number; elapsedMs: number }) => void;
};

export type GenerateResult = {
  digest: DayDigest;
  usage: EnrichUsage | null;
};

const DEFAULT_MODEL = "sonnet";

async function defaultCallLLMDigest(args: {
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
      "--append-system-prompt", DIGEST_DAY_SYSTEM_PROMPT,
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
        } catch { /* skip non-JSON framing */ }
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
    const r = DayDigestResponseSchema.safeParse(parsed);
    if (r.success) return { ok: true as const, value: r.data };
    return { ok: false as const, error: "schema: " + r.error.message };
  } catch (e) {
    return { ok: false as const, error: "json: " + (e as Error).message };
  }
}

export async function generateDayDigest(
  date: string,
  entries: Entry[],
  opts: GenerateOptions = {},
): Promise<GenerateResult> {
  const base = buildDeterministicDigest(date, entries, { concurrencyPeak: opts.concurrencyPeak });
  const enriched = entries.filter(e => e.enrichment.status === "done");
  if (enriched.length === 0) return { digest: base, usage: null };

  const model = opts.model ?? DEFAULT_MODEL;
  const callLLM = opts.callLLM ?? defaultCallLLMDigest;
  const userPrompt = buildDigestUserPrompt(base, entries);
  let inT = 0, outT = 0;
  // Initial value is the safety net for the throws-before-reassignment path,
  // even though the catch branch doesn't end up reading lastModel today.
  // eslint-disable-next-line no-useless-assignment
  let lastModel: string = model;

  try {
    const r1 = await callLLM({ model, userPrompt, onProgress: opts.onProgress });
    inT += r1.input_tokens; outT += r1.output_tokens; lastModel = r1.model;
    const v1 = parseAndValidate(r1.content);
    if (v1.ok) {
      return {
        digest: {
          ...base, model: lastModel, cost_usd: computeCostUsd(lastModel, inT, outT),
          headline: v1.value.headline,
          narrative: v1.value.narrative,
          what_went_well: v1.value.what_went_well,
          what_hit_friction: v1.value.what_hit_friction,
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
          ...base, model: lastModel, cost_usd: computeCostUsd(lastModel, inT, outT),
          headline: v2.value.headline,
          narrative: v2.value.narrative,
          what_went_well: v2.value.what_went_well,
          what_hit_friction: v2.value.what_hit_friction,
          suggestion: v2.value.suggestion,
        },
        usage: { input_tokens: inT, output_tokens: outT },
      };
    }

    console.warn(`[digest-day] ${date}: LLM response failed validation after retry (${v2.error})`);
    return { digest: base, usage: { input_tokens: inT, output_tokens: outT } };
  } catch (err) {
    console.warn(`[digest-day] ${date}: LLM invocation failed (${(err as Error).message})`);
    return { digest: base, usage: inT > 0 ? { input_tokens: inT, output_tokens: outT } : null };
  }
}
