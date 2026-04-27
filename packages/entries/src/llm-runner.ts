import { spawn } from "node:child_process";
import type { z } from "zod";
import type { LLMResponse } from "./enrich.js";

export type RunSubprocessArgs = {
  systemPrompt: string;
  model: string;
  userPrompt: string;
  reminder?: string;
  onProgress?: (info: { bytes: number; elapsedMs: number }) => void;
};

/** Spawn `claude -p` with the given system prompt; resolve with the assembled
 *  text + token usage. Used by all three digest synth callers (day/week/month). */
export function runClaudeSubprocess(args: RunSubprocessArgs): Promise<LLMResponse> {
  return new Promise((resolve, reject) => {
    const claudeArgs = [
      "-p", "--output-format", "stream-json", "--verbose",
      "--model", args.model, "--tools", "",
      "--disable-slash-commands", "--no-session-persistence",
      "--setting-sources", "",
      "--append-system-prompt", args.systemPrompt,
    ];
    const proc = spawn("claude", claudeArgs, { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env } });
    const stdinPayload = args.reminder ? `${args.userPrompt}\n\n---\n\n${args.reminder}` : args.userPrompt;
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

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/** Strip optional ```json fence + JSON.parse + Zod-validate. Used by all three digest synth callers. */
export function parseAndValidate<T>(content: string, schema: z.ZodType<T>): ParseResult<T> {
  const stripped = content.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```\s*$/, "").trim();
  try {
    const parsed = JSON.parse(stripped);
    const r = schema.safeParse(parsed);
    if (r.success) return { ok: true, value: r.data };
    return { ok: false, error: "schema: " + r.error.message };
  } catch (e) {
    return { ok: false, error: "json: " + (e as Error).message };
  }
}
