/**
 * Months index — drives the month picker in /insights.
 *
 * Returns the last N calendar months (newest first), with session count
 * observed in that window, in_progress flag for the current month, and
 * saved_key lookup (`month-YYYY-MM-01` convention).
 */
import { listSessions } from "@claude-lens/parser/fs";
import { calendarMonth } from "@claude-lens/parser";
import { listSavedReports, type SavedReportMeta } from "@/lib/ai/saved-reports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type MonthRow = {
  year: number;
  month: number;          // 1-12
  start: string;          // "2026-03-01"
  end: string;            // "2026-03-31"
  label: string;          // "March 2026"
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

export async function GET(req: Request) {
  const url = new URL(req.url);
  const count = Math.min(24, Math.max(1, parseInt(url.searchParams.get("count") ?? "6", 10)));

  const [metas, saved] = await Promise.all([listSessions({ limit: 10000 }), listSavedReports()]);
  const savedByKey = new Map<string, SavedReportMeta>(saved.map((s) => [s.key, s]));

  const now = new Date();
  const currentMonth = calendarMonth(now);

  const months: MonthRow[] = [];
  for (let i = 0; i < count; i++) {
    const anchor = new Date(now.getFullYear(), now.getMonth() - i, 15);
    const { start, end } = calendarMonth(anchor);
    const in_progress =
      start.getFullYear() === currentMonth.start.getFullYear()
      && start.getMonth() === currentMonth.start.getMonth();

    const startMs = start.getTime();
    const endMs = new Date(end).setHours(23, 59, 59, 999);
    const sessions = metas.filter((m) => {
      if (!m.firstTimestamp) return false;
      const t = Date.parse(m.firstTimestamp);
      return !Number.isNaN(t) && t >= startMs && t <= endMs;
    }).length;

    const startKey = isoDay(start);
    const savedMeta = savedByKey.get(`month-${startKey}`);
    months.push({
      year: start.getFullYear(),
      month: start.getMonth() + 1,
      start: startKey,
      end: isoDay(end),
      label: start.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
      sessions,
      in_progress,
      saved_key: savedMeta ? savedMeta.key : null,
      archetype_label: savedMeta?.archetype_label,
      sessions_used: savedMeta?.sessions_used,
      prs: savedMeta?.prs,
    });
  }

  return Response.json({ months });
}
