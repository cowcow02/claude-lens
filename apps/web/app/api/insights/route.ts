/**
 * Insights agent — structured ReportData pipeline.
 *
 * POST /api/insights
 *   { range_type: "week" | "4weeks" | "custom",
 *     since?: "YYYY-MM-DD", until?: "YYYY-MM-DD" }
 *
 * Streams SSE:
 *   { type: "status", text }    progress updates (agentic visibility)
 *   { type: "report", report }  full ReportData (one event when ready)
 *   { type: "done", promptTokens? }
 *   { type: "error", message }
 */
import { listSessions, getSession, loadUsageByDay } from "@claude-lens/parser/fs";
import {
  buildCapsule,
  buildPeriodBundle,
  aggregateConcurrency,
  calendarWeek,
  last4WeeksRange,
  computeBurstsFromSessions,
  type SessionCapsule,
  type PeriodBundle,
} from "@claude-lens/parser";
import { INSIGHTS_SYSTEM_PROMPT } from "@/lib/ai/insights-prompt";
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
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      }
      function finish() {
        if (!closed) {
          try { controller.close(); } catch { /* already closed */ }
          closed = true;
        }
      }

      try {
        // ── 1. Resolve range ────────────────────────────────────
        let range: { start: Date; end: Date; range_type: "week" | "4weeks" | "custom" };
        if (body.range_type === "4weeks") {
          range = { ...last4WeeksRange(), range_type: "4weeks" };
        } else if (body.range_type === "custom" && body.since && body.until) {
          range = {
            start: new Date(body.since),
            end: new Date(body.until),
            range_type: "custom",
          };
        } else {
          range = { ...calendarWeek(), range_type: "week" };
        }
        const rangeLabel = range.range_type === "4weeks" ? "last 4 weeks" : "this week";
        send({ type: "status", text: `Scanning sessions for ${rangeLabel}…` });

        // ── 2. Load sessions in range ───────────────────────────
        const metas = await listSessions({ limit: 10000 });
        const inRange = metas.filter((m) => {
          if (!m.firstTimestamp) return false;
          const t = new Date(m.firstTimestamp).getTime();
          return t >= range.start.getTime() && t <= range.end.getTime();
        });
        send({ type: "status", text: `Found ${inRange.length} sessions. Building capsules…` });

        // ── 3. Build capsules ───────────────────────────────────
        const caps: SessionCapsule[] = [];
        let trivial = 0;
        for (let i = 0; i < inRange.length; i++) {
          try {
            const d = await getSession(inRange[i]!.id);
            if (!d) continue;
            const cap = buildCapsule(d, { compact: true });
            if (cap.outcome === "trivial") {
              trivial++;
            } else {
              caps.push(cap);
            }
          } catch { /* skip */ }
          if ((i + 1) % 10 === 0) {
            send({ type: "status", text: `Built ${caps.length}/${inRange.length} capsules…` });
          }
        }

        // ── 4. Aggregates + concurrency + usage ─────────────────
        send({ type: "status", text: `Aggregating ${caps.length} sessions across ${range.range_type === "4weeks" ? 28 : 7} days…` });
        const bundle: PeriodBundle = buildPeriodBundle(caps, {
          period: range,
          trivial_dropped: trivial,
          sessions_total: inRange.length,
        });

        send({ type: "status", text: "Computing concurrency bursts…" });
        const bursts = computeBurstsFromSessions(inRange);
        bundle.concurrency = aggregateConcurrency(bursts, range);

        send({ type: "status", text: "Loading plan utilization…" });
        try {
          bundle.usage = await loadUsageByDay(range.start, range.end);
        } catch { /* optional */ }

        // ── 5. Call the analyst ─────────────────────────────────
        send({ type: "status", text: `${caps.length} substantive sessions · calling analyst…` });
        const payload = {
          period: bundle.period,
          aggregates: bundle,
          capsules: caps,
        };
        const userPrompt = `Period payload:\n\n${JSON.stringify(payload, null, 0)}\n\n---\n\nReturn the JSON per your system instructions.`;

        const narrative = await callAnalyst(userPrompt, send);
        if (!narrative) {
          send({ type: "error", message: "Analyst returned no parseable JSON." });
          finish();
          return;
        }

        // ── 6. Merge aggregates + narrative → ReportData ────────
        send({ type: "status", text: "Composing report…" });
        const startedAt = Date.now();
        const report = mergeReport(bundle, narrative, caps);
        report.meta.pipeline_ms = Date.now() - startedAt + /* placeholder */ 0;

        send({ type: "report", report });
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
  userPrompt: string,
  send: (data: Record<string, unknown>) => void,
): Promise<Narrative | null> {
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
    let streamed = 0;
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
                  streamed += block.text.length;
                  if (streamed % 200 < 40) {
                    send({ type: "status", text: `Analyst writing… (${streamed} chars)` });
                  }
                }
              }
            }
          }
        } catch { /* skip non-JSON framing lines */ }
      }
    });

    proc.stderr.on("data", () => { /* silence */ });

    proc.on("close", () => {
      const json = extractJsonBlock(buffer);
      if (!json) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(json) as Narrative);
      } catch {
        resolve(null);
      }
    });
    proc.on("error", () => resolve(null));
  });
}

function extractJsonBlock(s: string): string | null {
  // Prefer a ```json fence
  const fence = /```json\s*([\s\S]*?)```/m.exec(s);
  if (fence) return fence[1]!.trim();
  // Fallback: first { … last } spanning block
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first !== -1 && last > first) return s.slice(first, last + 1);
  return null;
}

// ──────────────────────────────────────────────────────────────────
//                     Merge → ReportData
// ──────────────────────────────────────────────────────────────────

function mergeReport(
  bundle: PeriodBundle,
  n: Narrative,
  caps: SessionCapsule[],
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

  const totalSubagentTurns = caps.filter((c) => c.numbers.subagent_turns > 0).length;
  const loopSessions = caps.filter((c) => c.numbers.consec_same_tool_max >= 8).length;

  return {
    period_label: `Week of ${bundle.period.label}`,
    period_sublabel: `Calendar ${bundle.period.range_type === "4weeks" ? "4-week rollup" : "week · Mon–Sun"}`,
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
      icon: safeIcon(p.icon),
      title: p.title,
      stat: p.stat,
      note: p.note,
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
    prior_weeks: [],
    saved_reports: [],
    meta: {
      generated_at: new Date().toISOString().replace("T", " ").slice(0, 16),
      sessions_total: bundle.counts.sessions_total,
      sessions_used: bundle.counts.substantive,
      trivial_dropped: bundle.counts.trivial_dropped,
      model: "claude-sonnet-4-6",
      pipeline_ms: 0,
      context_kb: Math.round(JSON.stringify({ bundle, caps }).length / 1024),
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
