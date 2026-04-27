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
import { runClaudeSubprocess, parseAndValidate } from "./llm-runner.js";

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

const defaultCallLLMDigest: CallLLM = (args) =>
  runClaudeSubprocess({ ...args, systemPrompt: DIGEST_DAY_SYSTEM_PROMPT });

const validateDay = (content: string) => parseAndValidate(content, DayDigestResponseSchema);

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
    const v1 = validateDay(r1.content);
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
    const v2 = validateDay(r2.content);
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
