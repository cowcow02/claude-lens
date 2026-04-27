import {
  runMonthDigestPipeline, readSettings,
  readMonthDigest, getCurrentMonthDigestFromCache,
} from "@claude-lens/entries/node";
import type { PipelineEvent } from "@claude-lens/entries/node";
import { InflightCoalescer } from "@/lib/inflight-coalesce";
import {
  isValidYearMonth, currentYearMonth, currentWeekMonday, todayLocal,
} from "@/lib/entries";
import { registerJob, updateJob, completeJob, failJob } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ yearMonth: string }> };

const coalescer = new InflightCoalescer<string, void>();

function updateJobFromEvent(jobId: string, ev: PipelineEvent): void {
  if (ev.type === "status") {
    updateJob(jobId, { progress: { phase: ev.phase, text: ev.text } });
  } else if (ev.type === "entry") {
    updateJob(jobId, { progress: { phase: "enrich", index: ev.index, total: ev.total } });
  } else if (ev.type === "progress") {
    updateJob(jobId, { progress: { phase: ev.phase, bytes: ev.bytes } });
  }
}

export async function GET(_req: Request, ctx: Params) {
  const { yearMonth } = await ctx.params;
  if (!isValidYearMonth(yearMonth)) {
    return new Response(JSON.stringify({ error: "invalid year-month" }), {
      status: 400, headers: { "content-type": "application/json" },
    });
  }
  if (yearMonth > currentYearMonth()) {
    return new Response(JSON.stringify({ error: "future month" }), { status: 400 });
  }

  const isCurrent = yearMonth === currentYearMonth();
  if (isCurrent) {
    const cached = getCurrentMonthDigestFromCache(yearMonth, Date.now());
    if (cached) {
      return new Response(JSON.stringify(cached), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ pending: true, current: true }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  }

  const cached = readMonthDigest(yearMonth);
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
  const { yearMonth } = await ctx.params;
  if (!isValidYearMonth(yearMonth)) {
    return new Response(JSON.stringify({ error: "invalid year-month" }), { status: 400 });
  }
  if (yearMonth > currentYearMonth()) {
    return new Response(JSON.stringify({ error: "future month" }), { status: 400 });
  }

  const url = new URL(req.url);
  const force = url.searchParams.get("force") === "1";
  const key = `month|${yearMonth}|${force ? 1 : 0}`;

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
        } catch { closed = true; }
      }
      function finish() {
        if (!closed) {
          try { controller.close(); } catch { /* ignore */ }
          closed = true;
        }
      }

      const alreadyInflight = coalescer.inflight(key);
      let jobId: string | null = null;

      try {
        await coalescer.run(key, async () => {
          if (alreadyInflight) return;
          jobId = registerJob({
            kind: "monthly.synth",
            label: `Month digest · ${yearMonth}`,
            target: yearMonth,
            caller: "user",
          });
          updateJob(jobId, { status: "running" });
          for await (const ev of runMonthDigestPipeline(yearMonth, {
            settings: settings.ai_features,
            force,
            currentYearMonth: currentYearMonth(),
            currentWeekMonday: currentWeekMonday(),
            todayLocalDay: todayLocal(),
          })) {
            send(ev);
            if (jobId) updateJobFromEvent(jobId, ev);
          }
          if (jobId) completeJob(jobId, `/insights/month-${yearMonth}`);
        });

        if (alreadyInflight) {
          const d = readMonthDigest(yearMonth) ?? getCurrentMonthDigestFromCache(yearMonth, Date.now());
          if (d) send({ type: "digest", digest: d });
          send({ type: "status", phase: "persist", text: "coalesced with in-flight request" });
        }
      } catch (err) {
        send({ type: "error", message: (err as Error).message });
        if (jobId) failJob(jobId, (err as Error).message);
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
