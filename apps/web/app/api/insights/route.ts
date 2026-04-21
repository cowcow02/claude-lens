/**
 * Insights agent — structured ReportData pipeline with persistence.
 *
 * POST /api/insights
 *   { range_type: "prior_week" | "week" | "4weeks_completed" | "4weeks" | "custom",
 *     since?: "YYYY-MM-DD", until?: "YYYY-MM-DD" }
 *
 * Streams SSE:
 *   { type: "status", phase: "data"|"analyst"|"compose", text }
 *   { type: "report", report }
 *   { type: "saved", key, saved_at }
 *   { type: "done" }
 *   { type: "error", message }
 */
import { listSessions, getSession, loadUsageByDay } from "@claude-lens/parser/fs";
import {
  buildCapsule,
  buildPeriodBundle,
  aggregateConcurrency,
  calendarWeek,
  priorCalendarWeek,
  last4CompletedWeeks,
  computeBurstsFromSessions,
  type SessionCapsule,
  type PeriodBundle,
} from "@claude-lens/parser";
import { INSIGHTS_SYSTEM_PROMPT } from "@/lib/ai/insights-prompt";
import { saveReport, keyForRange, listSavedReports, getSavedReport } from "@/lib/ai/saved-reports";
import { spawn } from "node:child_process";
import type { ReportData, IconKey } from "@/components/insight-report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Narrative = {
  archetype: { label: string; icon: string; tagline: string; why: string; vs_usual?: string };
  theme_headline: string;
  shipped_summaries: Record<string, string>;
  patterns: { icon: string; title: string; stat: string; note: string }[];
  concurrency_insight: string;
  concurrency_suggestion: string;
  outlier_notes: {
    longest_run?: string;
    fastest_ship?: string;
    most_errors?: string;
    wandered?: string;
  };
  suggestion_headline: string;
  suggestion_body: string;
};

const VALID_ICONS: IconKey[] = [
  "BrainCircuit", "ClipboardList", "Compass", "GitCommit", "Layers3",
  "Network", "Repeat", "Rocket", "Sparkles", "TrendingDown", "TrendingUp",
  "Users", "Zap",
];

function safeIcon(v: string): IconKey {
  return VALID_ICONS.includes(v as IconKey) ? (v as IconKey) : "Sparkles";
}

function resolveRange(body: { range_type?: string; since?: string; until?: string }): {
  start: Date; end: Date; range_type: ReportData["range_type"]; in_progress: boolean;
} {
  switch (body.range_type) {
    case "prior_week": {
      const r = priorCalendarWeek();
      return { ...r, range_type: "week", in_progress: false };
    }
    case "4weeks_completed": {
      const r = last4CompletedWeeks();
      return { ...r, range_type: "4weeks", in_progress: false };
    }
    case "4weeks": {
      const end = calendarWeek().end;
      const start = new Date(end);
      start.setDate(end.getDate() - 27);
      return { start, end, range_type: "4weeks", in_progress: true };
    }
    case "custom": {
      if (!body.since || !body.until) throw new Error("custom range requires since + until");
      return {
        start: new Date(body.since),
        end: new Date(body.until),
        range_type: "custom",
        in_progress: false,
      };
    }
    case "week":
    default: {
      const r = calendarWeek();
      return { ...r, range_type: "week", in_progress: true };
    }
  }
}

export async function POST(request: Request) {
  let body: { range_type?: string; since?: string; until?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      function send(data: Record<string, unknown>) {
        if (closed) return;
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); }
        catch { closed = true; }
      }
      const status = (phase: "data" | "analyst" | "compose", text: string) =>
        send({ type: "status", phase, text });
      function finish() {
        if (!closed) {
          try { controller.close(); } catch { /* already closed */ }
          closed = true;
        }
      }

      const t0 = Date.now();

      try {
        const range = resolveRange(body);
        const rangeLabel = range.range_type === "week"
          ? (range.in_progress ? "this week (in progress)" : "last week")
          : range.range_type === "4weeks"
            ? (range.in_progress ? "last 4 weeks (incl. current)" : "last 4 completed weeks")
            : "custom range";
        status("data", `Window: ${rangeLabel}`);

        // Phase 1 · Data
        const metas = await listSessions({ limit: 10000 });
        const inRange = metas.filter((m) => {
          if (!m.firstTimestamp) return false;
          const t = new Date(m.firstTimestamp).getTime();
          return t >= range.start.getTime() && t <= range.end.getTime();
        });
        status("data", `${inRange.length} sessions found in range`);

        const caps: SessionCapsule[] = [];
        let trivial = 0;
        const CONCURRENCY = 8;
        for (let i = 0; i < inRange.length; i += CONCURRENCY) {
          const slice = inRange.slice(i, i + CONCURRENCY);
          const results = await Promise.all(slice.map(async (m) => {
            try {
              const d = await getSession(m.id);
              if (!d) return null;
              return buildCapsule(d, { compact: true });
            } catch { return null; }
          }));
          for (const cap of results) {
            if (!cap) continue;
            if (cap.outcome === "trivial") trivial++;
            else caps.push(cap);
          }
          status("data", `Built ${caps.length}/${inRange.length} capsules (${trivial} trivial)`);
        }

        status("data", `Aggregating ${caps.length} sessions over ${Math.round((range.end.getTime() - range.start.getTime()) / 86400000) + 1} days`);
        const bundle: PeriodBundle = buildPeriodBundle(caps, {
          period: range,
          trivial_dropped: trivial,
          sessions_total: inRange.length,
        });

        status("data", "Computing concurrency bursts");
        bundle.concurrency = aggregateConcurrency(computeBurstsFromSessions(inRange), range);

        status("data", "Loading license utilization");
        try { bundle.usage = await loadUsageByDay(range.start, range.end); }
        catch { /* optional */ }

        status("data", "Loading prior reports for baseline comparison");
        const priorBaseline = await loadPriorWeeks(4);

        // Phase 2 · Analyst — stringify the payload once; reuse for status, prompt, and context_kb.
        const payloadJson = JSON.stringify({
          period: bundle.period,
          aggregates: bundle,
          capsules: caps,
          prior: priorBaseline,
        });
        const payloadKb = Math.round(payloadJson.length / 1024);
        status("analyst", `Sending ${payloadKb} KB to Claude (sonnet)`);

        const narrative = await callAnalyst(payloadJson, status);
        if (!narrative) {
          send({ type: "error", message: "Analyst returned no parseable JSON." });
          finish();
          return;
        }

        // Phase 3 · Compose
        status("compose", "Merging aggregates + narrative");
        const report = mergeReport(bundle, narrative, range, payloadKb, priorBaseline);
        report.meta.pipeline_ms = Date.now() - t0;

        send({ type: "report", report });

        // Persistence
        if (!range.in_progress) {
          status("compose", "Saving report to disk");
          const key = keyForRange(range.range_type, bundle.period.start);
          try {
            await saveReport(key, report);
            send({ type: "saved", key, saved_at: new Date().toISOString() });
          } catch (e) {
            send({ type: "status", phase: "compose", text: `(save failed: ${(e as Error).message})` });
          }
        }

        send({ type: "done" });
        finish();
      } catch (err) {
        send({ type: "error", message: (err as Error).message });
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

// ──────────────────────────────────────────────────────────────────
//                    Spawn claude -p, parse JSON
// ──────────────────────────────────────────────────────────────────

async function callAnalyst(
  payloadJson: string,
  status: (phase: "data" | "analyst" | "compose", text: string) => void,
): Promise<Narrative | null> {
  const userPrompt = `Period payload:\n\n${payloadJson}\n\n---\n\nReturn the JSON per your system instructions.`;

  return new Promise((resolve) => {
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

    let buffer = "";
    let lastReportedKb = -1;
    const phaseStart = Date.now();
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
                  const kb = Math.floor(buffer.length / 1024);
                  if (kb > lastReportedKb) {
                    lastReportedKb = kb;
                    const secs = Math.round((Date.now() - phaseStart) / 1000);
                    status("analyst", `Claude composing… ${buffer.length.toLocaleString()} chars (${secs}s)`);
                  }
                }
              }
            }
          }
        } catch { /* skip non-JSON framing */ }
      }
    });
    proc.on("close", () => {
      const json = extractJsonBlock(buffer);
      if (!json) { resolve(null); return; }
      try { resolve(JSON.parse(json) as Narrative); }
      catch { resolve(null); }
    });
    proc.on("error", () => resolve(null));
  });
}

function extractJsonBlock(s: string): string | null {
  const fence = /```json\s*([\s\S]*?)```/m.exec(s);
  if (fence) return fence[1]!.trim();
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first !== -1 && last > first) return s.slice(first, last + 1);
  return null;
}

// ──────────────────────────────────────────────────────────────────
//                     Merge → ReportData
// ──────────────────────────────────────────────────────────────────

type PriorWeek = {
  period_label: string;
  archetype: string;
  sessions: number;
  prs: number;
  subagents: number;
  agent_minutes: number;
};

async function loadPriorWeeks(limit: number): Promise<PriorWeek[]> {
  const all = await listSavedReports();
  const weeks = all.filter((r) => r.key.startsWith("week-")).slice(0, limit);
  const out: PriorWeek[] = [];
  for (const meta of weeks) {
    const r = await getSavedReport(meta.key);
    if (!r) continue;
    out.push({
      period_label: r.period_label,
      archetype: r.archetype.label,
      sessions: r.meta.sessions_used,
      prs: r.shipped.length,
      subagents: r.concurrency.peak, // rough proxy for ambition
      agent_minutes: r.days.reduce((a, d) => a + d.agent_minutes, 0),
    });
  }
  return out;
}

function mergeReport(
  bundle: PeriodBundle,
  n: Narrative,
  range: { in_progress: boolean },
  contextKb: number,
  priorWeeks: PriorWeek[],
): ReportData {
  const skillEntries = Object.entries(bundle.skills_total).sort((a, b) => b[1] - a[1]);
  const top_skills = skillEntries.slice(0, 6).map(([name, count]) => ({ name, count }));

  const days = bundle.by_day.map((d, i) => {
    const concOfDay = bundle.concurrency?.by_day[i];
    const useOfDay = bundle.usage?.by_day.find((u) => u.date === d.date);
    return {
      day_name: d.day_name,
      date_label: new Date(d.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      agent_minutes: Math.round(d.agent_min),
      sessions: d.sessions,
      concurrency_peak: concOfDay?.peak ?? 0,
      has_cross_project: Boolean(concOfDay?.has_cross_project),
      plan_util_pct: useOfDay?.peak_util_pct ?? 0,
      is_partial: new Date(d.date).getTime() > Date.now(),
    };
  });

  const projects = bundle.project_shares.map((p) => ({
    name: p.name,
    display_name: p.display_name,
    agent_minutes: Math.round(p.agent_min),
    share_pct: p.share_pct,
    prs: p.prs,
    commits: p.commits,
  }));

  const shipped = bundle.shipped_prs.map((s) => ({
    title: s.title,
    project: s.project,
    duration_label: fmtDuration(s.active_min),
    commits: s.commits,
    subagents: s.subagents,
    flags: s.flags,
    summary: n.shipped_summaries[s.session_id] ?? "",
  }));

  const outliers: ReportData["outliers"] = [];
  if (bundle.outliers.longest_run) {
    outliers.push({
      label: "Longest run",
      detail: fmtDuration(bundle.outliers.longest_run.active_min),
      note: n.outlier_notes.longest_run ?? bundle.outliers.longest_run.project,
    });
  }
  if (bundle.outliers.fastest_ship) {
    outliers.push({
      label: "Fastest ship",
      detail: fmtDuration(bundle.outliers.fastest_ship.active_min),
      note: n.outlier_notes.fastest_ship ?? bundle.outliers.fastest_ship.pr_title,
    });
  }
  if (bundle.outliers.most_errors) {
    outliers.push({
      label: "Most errors",
      detail: String(bundle.outliers.most_errors.tool_errors),
      note: n.outlier_notes.most_errors ?? bundle.outliers.most_errors.project,
    });
  }
  if (bundle.outliers.wandered) {
    outliers.push({
      label: "Wandered",
      detail: fmtDuration(bundle.outliers.wandered.active_min),
      note: n.outlier_notes.wandered ?? bundle.outliers.wandered.project,
    });
  }

  const periodPrefix = bundle.period.range_type === "4weeks" ? "Last 4 weeks ·" : "Week of";
  const in_progress_suffix = range.in_progress ? " · in progress" : "";

  return {
    period_label: `${periodPrefix} ${bundle.period.label}`,
    period_sublabel: `Calendar ${bundle.period.range_type === "4weeks" ? "4-week rollup" : "week · Mon–Sun"}${in_progress_suffix}`,
    range_type: bundle.period.range_type,
    archetype: {
      label: n.archetype.label,
      icon: safeIcon(n.archetype.icon),
      tagline: n.archetype.tagline,
      why: n.archetype.why,
      vs_usual: n.archetype.vs_usual,
    },
    top_skills,
    days,
    theme_headline: n.theme_headline,
    projects,
    shipped,
    patterns: n.patterns.map((p) => ({
      icon: safeIcon(p.icon), title: p.title, stat: p.stat, note: p.note,
    })),
    concurrency: {
      multi_agent_days: bundle.concurrency?.multi_agent_days ?? 0,
      peak: bundle.concurrency?.peak ?? 0,
      peak_day: bundle.concurrency?.peak_day
        ? new Date(bundle.concurrency.peak_day).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
        : "—",
      cross_project_days: bundle.concurrency?.cross_project_days ?? 0,
      insight: n.concurrency_insight,
      suggestion: n.concurrency_suggestion,
    },
    outliers,
    suggestion_headline: n.suggestion_headline,
    suggestion_body: n.suggestion_body,
    prior_weeks: priorWeeks,
    saved_reports: [],
    meta: {
      generated_at: new Date().toISOString().replace("T", " ").slice(0, 16),
      sessions_total: bundle.counts.sessions_total,
      sessions_used: bundle.counts.substantive,
      trivial_dropped: bundle.counts.trivial_dropped,
      model: "claude-sonnet-4-6",
      pipeline_ms: 0,
      context_kb: contextKb,
    },
  };
}

function fmtDuration(minutes: number): string {
  if (minutes < 60) {
    const whole = Math.floor(minutes);
    const secs = Math.round((minutes - whole) * 60);
    if (whole === 0 && secs > 0) return `${secs}s`;
    if (secs === 0) return `${whole}m`;
    return `${whole}m ${secs}s`;
  }
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes - h * 60);
  return `${h}h ${m}m`;
}
