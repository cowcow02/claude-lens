/**
 * Calendar-week / calendar-month helpers and concurrency aggregation.
 *
 * Pure — no fs, no network. Used by route handlers and the perception layer
 * to bucket sessions and bursts into period-shaped slices.
 */
import { toLocalDay, type ParallelismBurst } from "./analytics.js";

export type ConcurrencyAggregate = {
  by_day: { date: string; peak: number; has_cross_project: boolean }[];
  peak: number;
  peak_day?: string;
  multi_agent_days: number;
  cross_project_days: number;
};

export type UsageAggregate = {
  by_day: { date: string; peak_util_pct: number }[];
};

function isoDay(d: Date): string {
  return toLocalDay(d.getTime());
}

function rangeDays(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const stop = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cur.getTime() <= stop.getTime()) {
    out.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

/** Mon-Sun calendar week containing `ref`. */
export function calendarWeek(ref: Date = new Date()): { start: Date; end: Date } {
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const dow = d.getDay();
  const daysSinceMon = (dow + 6) % 7;
  const monday = new Date(d);
  monday.setDate(d.getDate() - daysSinceMon);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: monday, end: sunday };
}

/** Calendar week that ended most recently — i.e. the week before `ref`'s. */
export function priorCalendarWeek(ref: Date = new Date()): { start: Date; end: Date } {
  const cur = calendarWeek(ref);
  const prevEnd = new Date(cur.start);
  prevEnd.setDate(cur.start.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevEnd.getDate() - 6);
  return { start: prevStart, end: prevEnd };
}

/** Last 4 COMPLETED weeks (ends on the most recent Sunday, exclusive of the ongoing week). */
export function last4CompletedWeeks(ref: Date = new Date()): { start: Date; end: Date } {
  const { end } = priorCalendarWeek(ref);
  const start = new Date(end);
  start.setDate(end.getDate() - 27);
  return { start, end };
}

/** Calendar month containing `ref`, clamped to local midnight boundaries. */
export function calendarMonth(ref: Date = new Date()): { start: Date; end: Date } {
  const start = new Date(ref.getFullYear(), ref.getMonth(), 1);
  const end = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
  return { start, end };
}

/** Month before the one containing `ref`. */
export function priorCalendarMonth(ref: Date = new Date()): { start: Date; end: Date } {
  const start = new Date(ref.getFullYear(), ref.getMonth() - 1, 1);
  const end = new Date(ref.getFullYear(), ref.getMonth(), 0);
  return { start, end };
}

/**
 * Reduce parallelism bursts to a per-day concurrency summary.
 *
 * A burst is attributed to its start day (a cross-project blip that started
 * at 23:58 Monday is "Monday's concurrency," not Tuesday's).
 */
export function aggregateConcurrency(
  bursts: ParallelismBurst[],
  period: { start: Date; end: Date },
): ConcurrencyAggregate {
  const days = rangeDays(period.start, period.end);
  const byDayKey = new Map<string, { peak: number; has_cross_project: boolean }>();
  for (const d of days) byDayKey.set(isoDay(d), { peak: 0, has_cross_project: false });

  for (const b of bursts) {
    const dayKey = isoDay(new Date(b.startMs));
    const cur = byDayKey.get(dayKey);
    if (!cur) continue;
    if (b.peak > cur.peak) cur.peak = b.peak;
    if (b.crossProject) cur.has_cross_project = true;
  }

  const by_day = days.map((d) => {
    const k = isoDay(d);
    const v = byDayKey.get(k)!;
    return { date: k, peak: v.peak, has_cross_project: v.has_cross_project };
  });

  let peak = 0;
  let peak_day: string | undefined;
  let multi_agent_days = 0;
  let cross_project_days = 0;
  for (const d of by_day) {
    if (d.peak > peak) { peak = d.peak; peak_day = d.date; }
    if (d.peak >= 3) multi_agent_days++;
    if (d.has_cross_project) cross_project_days++;
  }

  return { by_day, peak, peak_day, multi_agent_days, cross_project_days };
}
