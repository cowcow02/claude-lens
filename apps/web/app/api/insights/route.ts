/**
 * Insights agent endpoint.
 *
 * POST /api/insights
 *   { range: "7d" | "30d" | "90d", mode?: "compact" | "full" }
 *
 * Loads sessions in range, builds per-session capsules, spawns a local
 * `claude -p` subprocess with the insights system prompt + the capsule
 * bundle, streams the narrative back as SSE.
 *
 * Response events:
 *   { type: "status", text: string }          // "loading sessions…", etc.
 *   { type: "delta", text: string }           // incremental narrative
 *   { type: "done", capsuleCount: number, promptTokens?: number }
 *   { type: "error", message: string }
 */
import { listSessions, getSession } from "@claude-lens/parser/fs";
import { buildCapsule, type SessionCapsule } from "@claude-lens/parser";
import { INSIGHTS_SYSTEM_PROMPT } from "@/lib/ai/insights-prompt";
import { spawn } from "node:child_process";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RANGE_DAYS: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90 };

export async function POST(request: Request) {
  let body: { range?: string; mode?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const rangeKey = body.range ?? "7d";
  const days = RANGE_DAYS[rangeKey];
  if (!days) return Response.json({ error: `invalid range '${rangeKey}'` }, { status: 400 });
  const compact = body.mode !== "full"; // default compact

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      function send(data: { type: string; [k: string]: unknown }) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      }

      try {
        send({ type: "status", text: `Scanning sessions in the last ${days}d…` });
        const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
        const metas = await listSessions();
        const inRange = metas.filter((m) => {
          if (!m.firstTimestamp) return false;
          const t = Date.parse(m.firstTimestamp);
          return !Number.isNaN(t) && t >= cutoffMs;
        });
        send({ type: "status", text: `Found ${inRange.length} sessions. Building capsules…` });

        const capsules: SessionCapsule[] = [];
        for (let i = 0; i < inRange.length; i++) {
          const meta = inRange[i]!;
          try {
            const detail = await getSession(meta.id);
            if (!detail) continue;
            const cap = buildCapsule(detail, { compact });
            // Drop trivial sessions entirely — they waste LLM context
            if (cap.outcome === "trivial") continue;
            capsules.push(cap);
          } catch {
            // skip unreadable
          }
          if ((i + 1) % 10 === 0) {
            send({ type: "status", text: `Built ${capsules.length}/${inRange.length} capsules…` });
          }
        }

        // Order oldest → newest so the narrative flows chronologically
        capsules.sort((a, b) => (a.start_iso ?? "").localeCompare(b.start_iso ?? ""));

        const bundle = JSON.stringify(capsules);
        const promptBytes = bundle.length + INSIGHTS_SYSTEM_PROMPT.length;
        send({ type: "status", text: `${capsules.length} substantive sessions · ${(promptBytes / 1024).toFixed(0)} KB context · starting analyst…` });

        const userPrompt = `Here are the session capsules for the last ${days} days (${capsules.length} substantive sessions, oldest first):\n\n${bundle}\n\n---\n\nWrite the retrospective now. Follow the rules in your system prompt.`;

        const args = [
          "-p",
          "--output-format", "stream-json",
          "--verbose",
          "--model", "sonnet",
          "--tools", "",
          "--disable-slash-commands",
          "--no-session-persistence",
          "--setting-sources", "",
          "--append-system-prompt", INSIGHTS_SYSTEM_PROMPT,
        ];
        const proc = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env } });
        proc.stdin.write(userPrompt);
        proc.stdin.end();

        let stderr = "";
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
                      send({ type: "delta", text: block.text });
                    }
                  }
                }
              }
              if (obj.type === "result") {
                const usage = obj.usage as Record<string, unknown> | undefined;
                const input = typeof usage?.input_tokens === "number" ? usage.input_tokens : undefined;
                send({ type: "done", capsuleCount: capsules.length, promptTokens: input });
              }
            } catch {
              // skip non-JSON
            }
          }
        });
        proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
        proc.on("close", (code) => {
          if (code !== 0 && !closed) {
            send({ type: "error", message: stderr.trim().slice(0, 300) || `claude exited with code ${code}` });
          }
          if (!closed) {
            try { controller.close(); } catch { /* already closed */ }
            closed = true;
          }
        });
        proc.on("error", (err) => {
          if (!closed) {
            send({ type: "error", message: `Failed to spawn claude: ${err.message}` });
            try { controller.close(); } catch { /* already closed */ }
            closed = true;
          }
        });
        request.signal.addEventListener("abort", () => {
          try { proc.kill("SIGTERM"); } catch { /* ignore */ }
          if (!closed) {
            try { controller.close(); } catch { /* already closed */ }
            closed = true;
          }
        });
      } catch (err) {
        send({ type: "error", message: (err as Error).message });
        if (!closed) {
          try { controller.close(); } catch { /* already closed */ }
          closed = true;
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
