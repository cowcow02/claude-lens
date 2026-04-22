import Anthropic from "@anthropic-ai/sdk";
import { classifyUserInputSource } from "./signals.js";
import { buildEnrichmentPrompt, EnrichmentResponseSchema } from "./prompts/enrich.js";
import type { Entry, EntryEnrichment } from "./types.js";

export type LLMResponse = {
  content: string;
  input_tokens: number;
  output_tokens: number;
  model: string;
};

export type CallLLM = (args: {
  apiKey: string;
  model: string;
  systemAndUserPrompt: string;
  reminder?: string;
}) => Promise<LLMResponse>;

export type EnrichOptions = {
  apiKey: string;
  model?: string;
  /** Test-only injection point. Default uses @anthropic-ai/sdk. */
  callLLM?: CallLLM;
};

export type EnrichUsage = {
  input_tokens: number;
  output_tokens: number;
};

export type EnrichResult = {
  entry: Entry;
  /** Aggregated token usage across all LLM attempts for this Entry.
   *  Null only when every attempt threw before returning a response (e.g., network failure). */
  usage: EnrichUsage | null;
};

const DEFAULT_MODEL = "claude-sonnet-4-6";

// Sonnet 4.6 pricing (USD per 1M tokens). Kept in-module rather than pulled
// from @claude-lens/parser to avoid CLI↔entries dep inversion. Bump here and
// in packages/cli/src/pricing.ts together if Anthropic changes prices.
const PRICE_USD_PER_1M: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-opus-4-7": { input: 15, output: 75 },
};

function computeCostUsd(model: string, inTokens: number, outTokens: number): number {
  const p = PRICE_USD_PER_1M[model];
  if (!p) return 0;
  return (inTokens * p.input + outTokens * p.output) / 1_000_000;
}

async function defaultCallLLM(args: {
  apiKey: string;
  model: string;
  systemAndUserPrompt: string;
  reminder?: string;
}): Promise<LLMResponse> {
  const client = new Anthropic({ apiKey: args.apiKey });
  const messages: Array<{ role: "user"; content: string }> = [
    { role: "user", content: args.systemAndUserPrompt },
  ];
  if (args.reminder) messages.push({ role: "user", content: args.reminder });

  const resp = await client.messages.create({
    model: args.model,
    max_tokens: 2048,
    messages,
  });
  const textBlock = resp.content.find(b => b.type === "text");
  const content = textBlock?.type === "text" ? textBlock.text : "";
  return {
    content,
    input_tokens: resp.usage.input_tokens,
    output_tokens: resp.usage.output_tokens,
    model: resp.model ?? args.model,
  };
}

function selectHumanTurns(entry: Entry): string[] {
  const turns: string[] = [];
  if (entry.first_user) turns.push(entry.first_user);
  for (const instr of entry.enrichment.user_instructions) turns.push(instr);
  return turns.filter(t => classifyUserInputSource(t) === "human");
}

function parseAndValidate(
  content: string,
): { ok: true; value: ReturnType<typeof EnrichmentResponseSchema.parse> } | { ok: false; error: string } {
  // Strip code fences if the model added them despite being told not to.
  const stripped = content.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```\s*$/, "").trim();
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

export async function enrichEntry(entry: Entry, opts: EnrichOptions): Promise<EnrichResult> {
  const model = opts.model ?? DEFAULT_MODEL;
  const callLLM = opts.callLLM ?? defaultCallLLM;
  const humanTurns = selectHumanTurns(entry);
  const prompt = buildEnrichmentPrompt(entry, humanTurns);
  const generatedAt = new Date().toISOString();

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let anyCallReturned = false;
  let lastModelId = model;
  let lastError = "";

  try {
    const r1 = await callLLM({ apiKey: opts.apiKey, model, systemAndUserPrompt: prompt });
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

    const r2 = await callLLM({
      apiKey: opts.apiKey,
      model,
      systemAndUserPrompt: prompt,
      reminder: "Your previous response was not valid JSON or did not match the required schema. Return ONLY the JSON object with the seven required fields — no prose, no code fence.",
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
  } catch (err) {
    lastError = (err as Error).message || "unknown LLM error";
  }

  const cost = computeCostUsd(lastModelId, totalInputTokens, totalOutputTokens);
  return {
    entry: applyEnrichmentError(entry, lastError, lastModelId, cost, generatedAt),
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
): Entry {
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
