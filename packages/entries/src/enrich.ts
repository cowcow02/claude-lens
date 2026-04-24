import { spawn } from "node:child_process";
import { classifyUserInputSource } from "./signals.js";
import {
  buildEnrichmentUserPrompt,
  ENRICHMENT_SYSTEM_PROMPT,
  EnrichmentResponseSchema,
} from "./prompts/enrich.js";
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

async function defaultCallLLM(args: {
  model: string;
  userPrompt: string;
  reminder?: string;
  onProgress?: (info: LLMProgress) => void;
}): Promise<LLMResponse> {
  return new Promise((resolve, reject) => {
    const claudeArgs = [
      "-p",
      "--output-format", "stream-json",
      "--verbose",
      "--model", args.model,
      "--tools", "",
      "--disable-slash-commands",
      "--no-session-persistence",
      "--setting-sources", "",
      "--append-system-prompt", ENRICHMENT_SYSTEM_PROMPT,
    ];
    const proc = spawn("claude", claudeArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    const stdinPayload = args.reminder
      ? `${args.userPrompt}\n\n---\n\n${args.reminder}`
      : args.userPrompt;
    proc.stdin.write(stdinPayload);
    proc.stdin.end();

    let buffer = "";
    let inputTokens = 0;
    let outputTokens = 0;
    let modelUsed = args.model;
    let stderr = "";
    const startMs = Date.now();
    let lastReportedKb = -1;

    proc.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const obj = JSON.parse(trimmed) as Record<string, unknown>;
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
            const msgModel = (msg as { model?: string } | undefined)?.model;
            if (msgModel) modelUsed = msgModel;
          }
          if (obj.type === "result") {
            const usage = obj.usage as { input_tokens?: number; output_tokens?: number } | undefined;
            if (usage) {
              inputTokens = usage.input_tokens ?? 0;
              outputTokens = usage.output_tokens ?? 0;
            }
          }
        } catch {
          // skip non-JSON lines (verbose debug framing)
        }
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    proc.on("close", (code) => {
      if (code !== 0 && !buffer) {
        reject(new Error(`claude exited ${code}: ${stderr.trim().slice(0, 300)}`));
        return;
      }
      resolve({
        content: buffer,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        model: modelUsed,
      });
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn claude: ${err.message}`));
    });
  });
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

export async function enrichEntry(entry: Entry, opts: EnrichOptions = {}): Promise<EnrichResult> {
  const model = opts.model ?? DEFAULT_MODEL;
  const callLLM = opts.callLLM ?? defaultCallLLM;
  const humanTurns = selectHumanTurns(entry);
  const userPrompt = buildEnrichmentUserPrompt(entry, humanTurns);
  const generatedAt = new Date().toISOString();

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let anyCallReturned = false;
  let lastModelId = model;
  let lastError = "";

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
