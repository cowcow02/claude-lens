/**
 * Timeline Gantt chart — visualize how sessions overlap per day.
 *
 * Shows one row per session, with colored segments for active periods
 * and gaps for idle time. Time axis is 24 hours. Date picker to
 * navigate between days.
 */

import { listSessions, getSession } from "@/lib/data";
import { buildGanttDay, type GanttDay } from "@claude-lens/parser";
import { GanttChart } from "./gantt-chart";
import { DateNav } from "./date-nav";
import { toLocalDay } from "@claude-lens/parser";

export const dynamic = "force-dynamic";

export default async function TimelinePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; range?: string }>;
}) {
  const { date: dateParam } = await searchParams;

  // Default to today.
  const today = toLocalDay(Date.now());
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : today;

  // Load all sessions, then load details for sessions that overlap
  // the target day. We use file mtime as a fast filter — only load
  // details for sessions whose mtime falls on the target day ± 1 day.
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const dayStartMs = new Date(y, m - 1, d).getTime();
  const dayEndMs = new Date(y, m - 1, d + 1).getTime();
  // Widen the window by 1 day on each side to catch sessions that
  // started the day before and carried into the target day.
  const filterStartMs = dayStartMs - 24 * 60 * 60 * 1000;
  const filterEndMs = dayEndMs + 24 * 60 * 60 * 1000;

  const allSessions = await listSessions();
  const candidates = allSessions.filter((s) => {
    if (!s.firstTimestamp) return false;
    const startMs = Date.parse(s.firstTimestamp);
    if (Number.isNaN(startMs)) return false;
    const endMs = s.lastTimestamp ? Date.parse(s.lastTimestamp) : startMs;
    // Session overlaps the ±1 day window.
    return endMs >= filterStartMs && startMs <= filterEndMs;
  });

  // Load full details for candidates (to get events for segment computation).
  // Cap at 80 sessions to avoid extremely slow loads.
  const details = (
    await Promise.all(candidates.slice(0, 80).map((s) => getSession(s.id)))
  ).filter((d): d is NonNullable<typeof d> => !!d);

  const gantt: GanttDay = buildGanttDay(details, date);

  // Find available days (for prev/next navigation).
  // Count sessions per day for the calendar heatmap.
  const daySessionCounts = new Map<string, number>();
  for (const s of allSessions) {
    if (!s.firstTimestamp) continue;
    const day = toLocalDay(Date.parse(s.firstTimestamp));
    daySessionCounts.set(day, (daySessionCounts.get(day) ?? 0) + 1);
  }
  const dayStats = Array.from(daySessionCounts.entries())
    .map(([date, sessions]) => ({ date, sessions }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const sortedDays = dayStats.map((d) => d.date);
  const currentIdx = sortedDays.indexOf(date);
  const prevDay = currentIdx > 0 ? sortedDays[currentIdx - 1] : undefined;
  const nextDay =
    currentIdx >= 0 && currentIdx < sortedDays.length - 1
      ? sortedDays[currentIdx + 1]
      : undefined;

  return (
    <div style={{ padding: "32px 40px", maxWidth: 1400 }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 24,
          flexWrap: "wrap",
          gap: 14,
        }}
      >
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>
            Timeline
          </h1>
          <p style={{ fontSize: 13, color: "var(--af-text-secondary)", marginTop: 4 }}>
            Active agent sessions on{" "}
            <strong>{date}</strong>
            {" · "}
            {gantt.sessions.length} session{gantt.sessions.length === 1 ? "" : "s"}
            {gantt.peakActiveParallelism > 1 && (
              <> · peak <strong>{gantt.peakActiveParallelism}×</strong> concurrent</>
            )}
          </p>
        </div>

        <DateNav date={date} today={today} prevDay={prevDay} nextDay={nextDay} dayStats={dayStats} />
      </header>

      {gantt.sessions.length === 0 ? (
        <div className="af-empty">
          No active sessions on {date}. Try a different date.
        </div>
      ) : (
        <GanttChart gantt={gantt} />
      )}
    </div>
  );
}
