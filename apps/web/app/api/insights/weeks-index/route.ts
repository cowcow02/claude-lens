/**
 * Weeks index — drives the week picker in /insights.
 *
 * Returns the last N calendar weeks (Mon-Sun, newest first) with:
 *   - isoweek + period label
 *   - session count observed in that window (raw SessionMeta filter)
 *   - in_progress flag for this week
 *   - saved_key when a report exists on disk
 *   - archetype_label + sessions_used from the saved report, for display
 */
import { listSessions } from "@claude-lens/parser/fs";
import { calendarWeek, priorCalendarWeek } from "@claude-lens/parser";
import { listSavedReports, type SavedReportMeta } from "@/lib/ai/saved-reports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type WeekRow = {
  iso_week: number;
  start: string;       // "2026-04-13"
  end: string;
  label: string;       // "Apr 13 – Apr 19"
  sessions: number;
  in_progress: boolean;
  saved_key: string | null;
  archetype_label?: string;
  sessions_used?: number;
  prs?: number;
};

function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isoWeekNo(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil((((t.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
}

function label(start: Date, end: Date): string {
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const count = Math.min(26, Math.max(1, parseInt(url.searchParams.get("count") ?? "12", 10)));

  const [metas, saved] = await Promise.all([listSessions({ limit: 10000 }), listSavedReports()]);
  const savedByKey = new Map<string, SavedReportMeta>(saved.map((s) => [s.key, s]));

  const current = calendarWeek();
  const prior = priorCalendarWeek();

  const weeks: WeekRow[] = [];
  for (let i = 0; i < count; i++) {
    let start: Date, end: Date, in_progress: boolean;
    if (i === 0) {
      start = current.start; end = current.end; in_progress = true;
    } else {
      const offset = (i - 1) * 7;
      start = new Date(prior.start); start.setDate(prior.start.getDate() - offset);
      end = new Date(prior.end); end.setDate(prior.end.getDate() - offset);
      in_progress = false;
    }
    const startMs = start.getTime();
    const endMs = new Date(end).setHours(23, 59, 59, 999);
    const sessions = metas.filter((m) => {
      if (!m.firstTimestamp) return false;
      const t = Date.parse(m.firstTimestamp);
      return !Number.isNaN(t) && t >= startMs && t <= endMs;
    }).length;
    const startKey = isoDay(start);
    const savedMeta = savedByKey.get(`week-${startKey}`);
    weeks.push({
      iso_week: isoWeekNo(start),
      start: startKey,
      end: isoDay(end),
      label: label(start, end),
      sessions,
      in_progress,
      saved_key: savedMeta ? savedMeta.key : null,
      archetype_label: savedMeta?.archetype_label,
      sessions_used: savedMeta?.sessions_used,
      prs: savedMeta?.prs,
    });
  }

  return Response.json({ weeks });
}
