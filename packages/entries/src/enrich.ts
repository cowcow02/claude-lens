import { classifyUserInputSource } from "./signals.js";
import {
  buildEnrichmentUserPrompt,
  ENRICHMENT_SYSTEM_PROMPT,
  EnrichmentResponseSchema,
} from "./prompts/enrich.js";
import { runClaudeSubprocess } from "./llm-runner.js";
import type { Entry, EntryEnrichment } from "./types.js";

export type LLMResponse = {
  content: string;
  input_tokens: number;
  output_tokens: number;
  model: string;
};

// CallLLM takes a model alias + user-prompt body. No apiKey: the default
// spawns the user's local `claude` CLI which uses their existing Claude Code
// auth (same pattern as /api/insights and /api/ask).
export type LLMProgress = { bytes: number; elapsedMs: number };

export type CallLLM = (args: {
  model: string;
  userPrompt: string;
  reminder?: string;
  /** Optional streaming-progress callback, fired at most once per additional KB of output. */
  onProgress?: (info: LLMProgress) => void;
}) => Promise<LLMResponse>;

export type EnrichOptions = {
  model?: string;
  /** Test-only injection point. Default spawns `claude -p`. */
  callLLM?: CallLLM;
  /** Optional char-count progress from the claude -p call. */
  onProgress?: (info: LLMProgress) => void;
};

export type EnrichUsage = {
  input_tokens: number;
  output_tokens: number;
};

export type EnrichResult = {
  entry: Entry;
  /** Aggregated token usage across all LLM attempts for this Entry.
   *  Null only when every attempt threw before returning a response (e.g., subprocess failure). */
  usage: EnrichUsage | null;
};

const DEFAULT_MODEL = "sonnet";

// Reference pricing for the spend log / monthly budget soft-cap. Subprocess
// mode uses the user's Claude Code subscription (no API billing), so these
// numbers don't represent actual charges — they're a rate-limiting proxy
// against runaway enrichment runs.
export function computeCostUsd(model: string, inTokens: number, outTokens: number): number {
  let p: { input: number; output: number } | undefined;
  if (model.includes("opus")) p = { input: 15, output: 75 };
  else if (model.includes("sonnet")) p = { input: 3, output: 15 };
  else if (model.includes("haiku")) p = { input: 1, output: 5 };
  else return 0;
  return (inTokens * p.input + outTokens * p.output) / 1_000_000;
}

// Delegate to the shared runner so entry-enrichment calls get the same
// MCP-strict + --effort medium flags AND write per-call traces to
// ~/.cclens/llm-runs/, making them visible on the /runs page alongside
// digest synth calls. Previously this site had its own duplicated spawn
// path that silently preloaded ~68K MCP cache_creation tokens per call —
// the worst offender for subscription-budget burn since enrichment runs
// once per session per day.
function defaultCallLLM(args: {
  model: string;
  userPrompt: string;
  reminder?: string;
  onProgress?: (info: LLMProgress) => void;
}): Promise<LLMResponse> {
  return runClaudeSubprocess({
    systemPrompt: ENRICHMENT_SYSTEM_PROMPT,
    model: args.model,
    userPrompt: args.userPrompt,
    reminder: args.reminder,
    onProgress: args.onProgress,
  });
}

function selectHumanTurns(entry: Entry): string[] {
  const turns: string[] = [];
  if (entry.first_user) turns.push(entry.first_user);
  for (const instr of entry.enrichment.user_instructions) turns.push(instr);
  return turns.filter(t => classifyUserInputSource(t) === "human");
}

/** Heuristic: does content look like a Claude rate-limit / quota error body
 *  rather than a genuine model response? These messages are plain English,
 *  not JSON, and the right response is to back off, not burn a retry slot. */
function looksLikeRateLimit(content: string): boolean {
  const head = content.trim().slice(0, 200).toLowerCase();
  return (
    head.startsWith("you've hit") ||
    head.startsWith("you have hit") ||
    head.startsWith("you have reached") ||
    head.startsWith("rate limit") ||
    head.includes("5-hour limit") ||
    head.includes("weekly limit") ||
    head.includes("usage limit")
  );
}

function parseAndValidate(
  content: string,
): { ok: true; value: ReturnType<typeof EnrichmentResponseSchema.parse> } | { ok: false; error: string; rateLimited?: boolean } {
  // Strip code fences if the model added them despite being told not to.
  const stripped = content.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```\s*$/, "").trim();
  if (looksLikeRateLimit(stripped)) {
    return { ok: false, error: "rate-limited: " + stripped.slice(0, 160), rateLimited: true };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    return { ok: false, error: "JSON parse failed: " + (err as Error).message };
  }
  const result = EnrichmentResponseSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, error: "schema validation failed: " + result.error.message };
  }
  return { ok: true, value: result.data };
}

export async function enrichEntry(entry: Entry, opts: EnrichOptions = {}): Promise<EnrichResult> {
  const model = opts.model ?? DEFAULT_MODEL;
  const callLLM = opts.callLLM ?? defaultCallLLM;
  const humanTurns = selectHumanTurns(entry);
  const userPrompt = buildEnrichmentUserPrompt(entry, humanTurns);
  const generatedAt = new Date().toISOString();

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let anyCallReturned = false;
  let lastModelId: string = model;
  // Initial empty string is the safety net for the (unreachable today)
  // path where neither the try body nor catch block runs assignment.
  // Removing it would make TS complain about possibly-unassigned reads.
  // eslint-disable-next-line no-useless-assignment
  let lastError = "";
  // Track whether every failure we've seen has been a rate-limit signature.
  // If both attempts hit rate limits, we DON'T increment retry_count —
  // the problem is exogenous (daemon hit its 5h cap) and the entry should
  // stay "pending" so the next sweep can try again cleanly instead of
  // burning one of three precious retries on a spurious error.
  let allFailuresWereRateLimit = true;

  try {
    const r1 = await callLLM({ model, userPrompt, onProgress: opts.onProgress });
    anyCallReturned = true;
    totalInputTokens += r1.input_tokens;
    totalOutputTokens += r1.output_tokens;
    lastModelId = r1.model;
    const v1 = parseAndValidate(r1.content);
    if (v1.ok) {
      const cost = computeCostUsd(lastModelId, totalInputTokens, totalOutputTokens);
      return {
        entry: applyEnrichmentSuccess(entry, v1.value, lastModelId, cost, generatedAt),
        usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens },
      };
    }
    lastError = v1.error;
    if (!v1.rateLimited) allFailuresWereRateLimit = false;

    // On rate limit, skip the immediate retry — it will also hit the cap
    // and just waste time. Bail with a soft error.
    if (!v1.rateLimited) {
      const r2 = await callLLM({
        model,
        userPrompt,
        reminder: "Your previous response was not valid JSON or did not match the required schema. Return ONLY the JSON object with the seven required fields — no prose, no code fence.",
        onProgress: opts.onProgress,
      });
      totalInputTokens += r2.input_tokens;
      totalOutputTokens += r2.output_tokens;
      lastModelId = r2.model;
      const v2 = parseAndValidate(r2.content);
      if (v2.ok) {
        const cost = computeCostUsd(lastModelId, totalInputTokens, totalOutputTokens);
        return {
          entry: applyEnrichmentSuccess(entry, v2.value, lastModelId, cost, generatedAt),
          usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens },
        };
      }
      lastError = v2.error;
      if (!v2.rateLimited) allFailuresWereRateLimit = false;
    }
  } catch (err) {
    lastError = (err as Error).message || "unknown LLM error";
    allFailuresWereRateLimit = false;
  }

  const cost = computeCostUsd(lastModelId, totalInputTokens, totalOutputTokens);
  return {
    entry: applyEnrichmentError(entry, lastError, lastModelId, cost, generatedAt, allFailuresWereRateLimit),
    usage: anyCallReturned
      ? { input_tokens: totalInputTokens, output_tokens: totalOutputTokens }
      : null,
  };
}

function applyEnrichmentSuccess(
  entry: Entry,
  resp: ReturnType<typeof EnrichmentResponseSchema.parse>,
  model: string,
  costUsd: number,
  generatedAt: string,
): Entry {
  const enrichment: EntryEnrichment = {
    ...entry.enrichment,
    status: "done",
    generated_at: generatedAt,
    model,
    cost_usd: costUsd,
    error: null,
    brief_summary: resp.brief_summary,
    underlying_goal: resp.underlying_goal,
    friction_detail: resp.friction_detail,
    user_instructions: resp.user_instructions,
    goal_categories: resp.goal_categories,
    outcome: resp.outcome,
    claude_helpfulness: resp.claude_helpfulness,
    // retry_count unchanged on success
  };
  return { ...entry, enrichment };
}

function applyEnrichmentError(
  entry: Entry,
  errorMessage: string,
  model: string,
  costUsd: number,
  generatedAt: string,
  /** When true, the only failures were rate-limit errors (exogenous) — keep
   *  status=pending so the next daemon sweep retries cleanly without burning
   *  a retry slot. Otherwise record as a real error and bump retry_count. */
  rateLimited: boolean = false,
): Entry {
  if (rateLimited) {
    const enrichment: EntryEnrichment = {
      ...entry.enrichment,
      status: "pending",
      generated_at: generatedAt,
      model,
      cost_usd: costUsd,
      error: errorMessage,
      // retry_count NOT incremented on rate-limit.
    };
    return { ...entry, enrichment };
  }
  const enrichment: EntryEnrichment = {
    ...entry.enrichment,
    status: "error",
    generated_at: generatedAt,
    model,
    cost_usd: costUsd,
    error: errorMessage,
    retry_count: (entry.enrichment.retry_count ?? 0) + 1,
  };
  return { ...entry, enrichment };
}
