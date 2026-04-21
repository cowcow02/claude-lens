/**
 * Period-level aggregator over SessionCapsule[].
 *
 * The second half of the insights LLM payload: day buckets, project
 * shares, shipped PRs, outliers, flag counts. Pure function — takes
 * capsules + a period window, returns a deterministic bundle.
 *
 * Concurrency (from parallelism bursts) and usage (from daemon
 * snapshots) are computed separately and attached by the caller.
 */
import type { SessionCapsule } from "./capsule.js";
import { canonicalProjectName, toLocalDay, type ParallelismBurst } from "./analytics.js";

export type DayBucket = {
  date: string;          // "2026-04-14"
  day_name: string;      // "Mon"
  agent_min: number;
  sessions: number;
};

export type ProjectShare = {
  name: string;
  display_name: string;
  agent_min: number;
  share_pct: number;
  prs: number;
  commits: number;
};

export type ShippedPr = {
  title: string;
  project: string;
  session_id: string;
  start_iso: string;
  active_min: number;
  commits: number;
  subagents: number;
  flags: string[];
};

export type OutlierRef = { session_id: string; project: string; active_min: number };

export type PeriodOutliers = {
  longest_run?: OutlierRef & { flags: string[] };
  fastest_ship?: OutlierRef & { pr_title: string };
  most_errors?: OutlierRef & { tool_errors: number };
  wandered?: OutlierRef;
};

export type ConcurrencyAggregate = {
  by_day: { date: string; peak: number; has_cross_project: boolean }[];
  peak: number;
  peak_day?: string;
  multi_agent_days: number;   // days with peak ≥ 3
  cross_project_days: number;
};

export type UsageAggregate = {
  by_day: { date: string; peak_util_pct: number }[];
};

export type PeriodBundle = {
  period: {
    start: string;
    end: string;
    label: string;
    day_count: number;
    range_type: "week" | "4weeks" | "month" | "custom";
  };
  counts: {
    sessions_total: number;
    substantive: number;
    trivial_dropped: number;
  };
  totals: {
    agent_min: number;
    commits: number;
    pushes: number;
    prs: number;
    subagent_calls: number;
    tool_errors: number;
  };
  by_day: DayBucket[];
  project_shares: ProjectShare[];
  shipped_prs: ShippedPr[];
  flags_count: Record<string, number>;
  skills_total: Record<string, number>;
  outliers: PeriodOutliers;
  concurrency?: ConcurrencyAggregate;
  usage?: UsageAggregate;
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

function prettyProjectName(p: string): string {
  const cleaned = p.replace(/^\/Users\/[^/]+\//, "");
  return cleaned || p;
}

export function buildPeriodBundle(
  caps: SessionCapsule[],
  opts: {
    period: { start: Date; end: Date; range_type?: "week" | "4weeks" | "month" | "custom" };
    trivial_dropped: number;
    sessions_total: number;
  },
): PeriodBundle {
  const { period, trivial_dropped, sessions_total } = opts;
  const days = rangeDays(period.start, period.end);
  const dayKeys = new Map(days.map((d) => [isoDay(d), d]));

  // ---- by_day ----
  const dayAgent = new Map<string, number>();
  const daySessions = new Map<string, number>();
  for (const k of dayKeys.keys()) {
    dayAgent.set(k, 0);
    daySessions.set(k, 0);
  }
  for (const c of caps) {
    if (!c.start_iso) continue;
    const d = isoDay(new Date(c.start_iso));
    if (!dayAgent.has(d)) continue;
    dayAgent.set(d, (dayAgent.get(d) ?? 0) + c.numbers.active_min);
    daySessions.set(d, (daySessions.get(d) ?? 0) + 1);
  }
  const by_day: DayBucket[] = days.map((d) => {
    const key = isoDay(d);
    return {
      date: key,
      day_name: DAY_NAMES[d.getDay()]!,
      agent_min: Math.round((dayAgent.get(key) ?? 0) * 10) / 10,
      sessions: daySessions.get(key) ?? 0,
    };
  });

  // ---- project_shares ----
  const projectAccum = new Map<string, { agent_min: number; prs: number; commits: number }>();
  for (const c of caps) {
    const canon = canonicalProjectName(c.project ?? "unknown");
    const b = projectAccum.get(canon) ?? { agent_min: 0, prs: 0, commits: 0 };
    b.agent_min += c.numbers.active_min;
    b.prs += c.numbers.prs;
    b.commits += c.numbers.commits;
    projectAccum.set(canon, b);
  }
  const totalProjectMin = [...projectAccum.values()].reduce((a, b) => a + b.agent_min, 0);
  const project_shares: ProjectShare[] = [...projectAccum.entries()]
    .map(([name, b]) => ({
      name,
      display_name: prettyProjectName(name),
      agent_min: Math.round(b.agent_min * 10) / 10,
      share_pct: totalProjectMin === 0 ? 0 : Math.round((b.agent_min / totalProjectMin) * 100),
      prs: b.prs,
      commits: b.commits,
    }))
    .sort((a, b) => b.agent_min - a.agent_min);

  // ---- shipped PRs ----
  const shipped_prs: ShippedPr[] = [];
  for (const c of caps) {
    for (const title of c.pr_titles) {
      shipped_prs.push({
        title,
        project: prettyProjectName(canonicalProjectName(c.project ?? "")),
        session_id: c.session_id,
        start_iso: c.start_iso ?? "",
        active_min: c.numbers.active_min,
        commits: c.numbers.commits,
        subagents: c.numbers.subagent_calls,
        flags: c.flags,
      });
    }
  }

  // ---- flags_count + skills_total + totals ----
  const flags_count: Record<string, number> = {};
  const skills_total: Record<string, number> = {};
  const totals = { agent_min: 0, commits: 0, pushes: 0, prs: 0, subagent_calls: 0, tool_errors: 0 };
  for (const c of caps) {
    for (const f of c.flags) flags_count[f] = (flags_count[f] ?? 0) + 1;
    if (c.skills) {
      for (const [k, v] of Object.entries(c.skills)) {
        skills_total[k] = (skills_total[k] ?? 0) + v;
      }
    }
    totals.agent_min += c.numbers.active_min;
    totals.commits += c.numbers.commits;
    totals.pushes += c.numbers.pushes;
    totals.prs += c.numbers.prs;
    totals.subagent_calls += c.numbers.subagent_calls;
    totals.tool_errors += c.numbers.tool_errors;
  }
  totals.agent_min = Math.round(totals.agent_min * 10) / 10;

  // ---- outliers ----
  const longest = [...caps].sort((a, b) => b.numbers.active_min - a.numbers.active_min)[0];
  const shipped = caps.filter((c) => c.numbers.prs >= 1);
  const fastest = shipped.sort((a, b) => a.numbers.active_min - b.numbers.active_min)[0];
  const mostErr = [...caps].sort((a, b) => b.numbers.tool_errors - a.numbers.tool_errors)[0];
  const wandered = [...caps]
    .filter((c) => c.outcome === "exploratory"
      && c.numbers.prs === 0 && c.numbers.commits === 0 && c.numbers.pushes === 0
      && c.numbers.active_min >= 10)
    .sort((a, b) => b.numbers.active_min - a.numbers.active_min)[0];

  const outliers: PeriodOutliers = {};
  if (longest && longest.numbers.active_min > 0) {
    outliers.longest_run = {
      session_id: longest.session_id,
      project: prettyProjectName(canonicalProjectName(longest.project ?? "")),
      active_min: longest.numbers.active_min,
      flags: longest.flags,
    };
  }
  if (fastest) {
    outliers.fastest_ship = {
      session_id: fastest.session_id,
      project: prettyProjectName(canonicalProjectName(fastest.project ?? "")),
      active_min: fastest.numbers.active_min,
      pr_title: fastest.pr_titles[0] ?? "",
    };
  }
  if (mostErr && mostErr.numbers.tool_errors > 0) {
    outliers.most_errors = {
      session_id: mostErr.session_id,
      project: prettyProjectName(canonicalProjectName(mostErr.project ?? "")),
      active_min: mostErr.numbers.active_min,
      tool_errors: mostErr.numbers.tool_errors,
    };
  }
  if (wandered) {
    outliers.wandered = {
      session_id: wandered.session_id,
      project: prettyProjectName(canonicalProjectName(wandered.project ?? "")),
      active_min: wandered.numbers.active_min,
    };
  }

  // ---- label ----
  const label = period.range_type === "month"
    ? period.start.toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : `${period.start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} — ${period.end.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;

  return {
    period: {
      start: isoDay(period.start),
      end: isoDay(period.end),
      label,
      day_count: days.length,
      range_type: period.range_type ?? "custom",
    },
    counts: { sessions_total, substantive: caps.length, trivial_dropped },
    totals,
    by_day,
    project_shares,
    shipped_prs,
    flags_count,
    skills_total,
    outliers,
  };
}

/**
 * Calendar-week helpers: compute the Mon-Sun window containing a date,
 * or the Mon-Sun window N weeks ago.
 */
export function calendarWeek(ref: Date = new Date()): { start: Date; end: Date } {
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  const dow = d.getDay(); // 0 = Sun, 1 = Mon, ...
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
  const end = new Date(ref.getFullYear(), ref.getMonth() + 1, 0); // last day of ref's month
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
 * A burst is attributed to its *start* day (a 3-minute cross-project blip
 * that started at 23:58 Mon is "Monday's concurrency," not Tuesday's).
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
