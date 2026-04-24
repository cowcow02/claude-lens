import {
  runDayDigestPipeline, readSettings, getTodayDigestFromCache,
} from "@claude-lens/entries/node";
import type { PipelineEvent } from "@claude-lens/entries/node";
import { readDayDigest } from "@claude-lens/entries/fs";
import { InflightCoalescer } from "@/lib/inflight-coalesce";
import { isValidDate, todayLocal } from "@/lib/entries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ date: string }> };

// Keyed by `${date}|${force ? 1 : 0}` — force=1 requests never coalesce
// with force=0 (different key), matching spec §S2.
const coalescer = new InflightCoalescer<string, void>();

export async function GET(_req: Request, ctx: Params) {
  const { date } = await ctx.params;
  if (!isValidDate(date)) {
    return new Response(JSON.stringify({ error: "invalid date" }), {
      status: 400, headers: { "content-type": "application/json" },
    });
  }
  if (date > todayLocal()) {
    return new Response(JSON.stringify({ error: "future date" }), {
      status: 400, headers: { "content-type": "application/json" },
    });
  }

  if (date === todayLocal()) {
    const cached = getTodayDigestFromCache(date, Date.now());
    if (cached) {
      return new Response(JSON.stringify(cached), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ pending: true, today: true }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }

  const cached = readDayDigest(date);
  if (cached) {
    return new Response(JSON.stringify(cached), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ pending: true }), {
    status: 200, headers: { "content-type": "application/json" },
  });
}

export async function POST(req: Request, ctx: Params) {
  const { date } = await ctx.params;
  if (!isValidDate(date)) {
    return new Response(JSON.stringify({ error: "invalid date" }), { status: 400 });
  }
  if (date > todayLocal()) {
    return new Response(JSON.stringify({ error: "future date" }), { status: 400 });
  }

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const key = `${date}|${force ? 1 : 0}`;

  const encoder = new TextEncoder();
  const settings = readSettings();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      function send(event: PipelineEvent) {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
          );
        } catch {
          closed = true;
        }
      }
      function finish() {
        if (!closed) {
          try { controller.close(); } catch { /* already */ }
          closed = true;
        }
      }

      const alreadyInflight = coalescer.inflight(key);

      try {
        await coalescer.run(key, async () => {
          if (alreadyInflight) return;
          for await (const ev of runDayDigestPipeline(date, {
            settings: settings.ai_features,
            force,
            todayLocalDay: todayLocal(),
          })) {
            send(ev);
          }
        });

        if (alreadyInflight) {
          const d = readDayDigest(date) ?? getTodayDigestFromCache(date, Date.now());
          if (d) send({ type: "digest", digest: d });
          send({ type: "status", phase: "persist", text: "coalesced with in-flight request" });
        }
      } catch (err) {
        send({ type: "error", message: (err as Error).message });
      } finally {
        try { controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`)); } catch { /* ignore */ }
        finish();
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
