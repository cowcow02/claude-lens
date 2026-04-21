import { describe, it, expect } from "vitest";
import {
  buildPeriodBundle,
  aggregateConcurrency,
  calendarWeek,
  priorCalendarWeek,
  last4CompletedWeeks,
} from "../src/aggregate.js";
import type { SessionCapsule } from "../src/capsule.js";
import type { ParallelismBurst } from "../src/analytics.js";

const mkCapsule = (overrides: Partial<SessionCapsule> = {}): SessionCapsule => ({
  session_id: "s1",
  project: "/Users/me/Repo/foo",
  start_iso: "2026-04-13T10:00:00Z",
  end_iso: "2026-04-13T11:00:00Z",
  outcome: "shipped",
  flags: [],
  model_mix: { "claude-opus-4-6": 10 },
  numbers: {
    active_min: 30,
    turn_count: 5,
    longest_turn_min: 10,
    median_turn_min: 3,
    p90_turn_min: 8,
    tools_total: 40,
    tokens_total: 100_000,
    subagent_turns: 0,
    subagent_calls: 0,
    skill_calls: 1,
    task_ops: 0,
    interrupts: 0,
    tool_errors: 0,
    consec_same_tool_max: 3,
    exit_plan_calls: 0,
    prs: 1,
    commits: 3,
    pushes: 1,
  },
  pr_titles: ["feat: test"],
  first_user: "do the thing",
  final_agent: "done",
  ...overrides,
});

describe("calendar range helpers", () => {
  it("calendarWeek returns Mon→Sun containing the ref date", () => {
    const thu = new Date(2026, 3, 16); // Thu Apr 16 2026
    const r = calendarWeek(thu);
    expect(r.start.getDay()).toBe(1); // Mon
    expect(r.end.getDay()).toBe(0); // Sun
    expect(r.start.getDate()).toBe(13);
    expect(r.end.getDate()).toBe(19);
  });

  it("calendarWeek handles a Monday ref", () => {
    const mon = new Date(2026, 3, 20);
    const r = calendarWeek(mon);
    expect(r.start.getDate()).toBe(20);
    expect(r.end.getDate()).toBe(26);
  });

  it("priorCalendarWeek returns the week BEFORE the one containing ref", () => {
    const ref = new Date(2026, 3, 16); // mid-week of Apr 13–19
    const r = priorCalendarWeek(ref);
    expect(r.start.getDate()).toBe(6);
    expect(r.end.getDate()).toBe(12);
  });

  it("last4CompletedWeeks ends on the most recent Sunday", () => {
    const ref = new Date(2026, 3, 20); // Mon Apr 20
    const r = last4CompletedWeeks(ref);
    expect(r.end.getDate()).toBe(19); // Sun Apr 19
    const spanDays = Math.round((r.end.getTime() - r.start.getTime()) / 86_400_000) + 1;
    expect(spanDays).toBe(28);
  });
});

describe("buildPeriodBundle", () => {
  const period = {
    start: new Date(2026, 3, 13),
    end: new Date(2026, 3, 19),
    range_type: "week" as const,
  };

  it("buckets agent time by day and fills empty days with zero", () => {
    const caps = [
      mkCapsule({ start_iso: "2026-04-13T10:00:00Z", numbers: { ...mkCapsule().numbers, active_min: 30 } }),
      mkCapsule({ session_id: "s2", start_iso: "2026-04-15T10:00:00Z", numbers: { ...mkCapsule().numbers, active_min: 60 } }),
    ];
    const bundle = buildPeriodBundle(caps, { period, trivial_dropped: 0, sessions_total: 2 });
    expect(bundle.by_day).toHaveLength(7);
    expect(bundle.by_day[0]!.date).toBe("2026-04-13");
    expect(bundle.by_day[0]!.agent_min).toBe(30);
    expect(bundle.by_day[2]!.agent_min).toBe(60);
    expect(bundle.by_day[1]!.agent_min).toBe(0); // Tue is quiet
  });

  it("groups by canonical project and sorts descending by agent_min", () => {
    const caps = [
      mkCapsule({ project: "/Users/me/Repo/foo", numbers: { ...mkCapsule().numbers, active_min: 10 } }),
      mkCapsule({ session_id: "s2", project: "/Users/me/Repo/bar", numbers: { ...mkCapsule().numbers, active_min: 50 } }),
    ];
    const bundle = buildPeriodBundle(caps, { period, trivial_dropped: 0, sessions_total: 2 });
    expect(bundle.project_shares[0]!.name).toBe("/Users/me/Repo/bar");
    expect(bundle.project_shares[0]!.share_pct).toBeGreaterThan(bundle.project_shares[1]!.share_pct);
  });

  it("rolls worktrees under the parent project", () => {
    const caps = [
      mkCapsule({ project: "/Users/me/Repo/foo", numbers: { ...mkCapsule().numbers, active_min: 10 } }),
      mkCapsule({ session_id: "s2", project: "/Users/me/Repo/foo/.worktrees/feat-a", numbers: { ...mkCapsule().numbers, active_min: 20 } }),
    ];
    const bundle = buildPeriodBundle(caps, { period, trivial_dropped: 0, sessions_total: 2 });
    expect(bundle.project_shares).toHaveLength(1);
    expect(bundle.project_shares[0]!.agent_min).toBe(30);
  });

  it("populates outliers from capsule data", () => {
    const caps = [
      mkCapsule({ session_id: "long", numbers: { ...mkCapsule().numbers, active_min: 300, prs: 0 } }),
      mkCapsule({ session_id: "fast", numbers: { ...mkCapsule().numbers, active_min: 2, prs: 1 } }),
      mkCapsule({ session_id: "errs", numbers: { ...mkCapsule().numbers, tool_errors: 99 } }),
    ];
    const bundle = buildPeriodBundle(caps, { period, trivial_dropped: 0, sessions_total: 3 });
    expect(bundle.outliers.longest_run?.session_id).toBe("long");
    expect(bundle.outliers.fastest_ship?.session_id).toBe("fast");
    expect(bundle.outliers.most_errors?.session_id).toBe("errs");
  });

  it("counts flags across sessions", () => {
    const caps = [
      mkCapsule({ flags: ["high_errors", "loop_suspected"] }),
      mkCapsule({ session_id: "s2", flags: ["loop_suspected"] }),
    ];
    const bundle = buildPeriodBundle(caps, { period, trivial_dropped: 0, sessions_total: 2 });
    expect(bundle.flags_count).toEqual({ high_errors: 1, loop_suspected: 2 });
  });
});

describe("aggregateConcurrency", () => {
  const period = {
    start: new Date(2026, 3, 13),
    end: new Date(2026, 3, 19),
  };

  it("buckets bursts by start-day and tracks peak + cross-project flag", () => {
    const wedMs = new Date(2026, 3, 15, 10, 0, 0).getTime();
    const friMs = new Date(2026, 3, 17, 14, 0, 0).getTime();
    const bursts: ParallelismBurst[] = [
      { startMs: wedMs, endMs: wedMs + 3_600_000, peak: 4, sessionIds: ["a", "b"], projectDirs: ["p1", "p2"], crossProject: true },
      { startMs: friMs, endMs: friMs + 1_800_000, peak: 2, sessionIds: ["a"], projectDirs: ["p1"], crossProject: false },
    ];
    const c = aggregateConcurrency(bursts, period);
    expect(c.peak).toBe(4);
    expect(c.peak_day).toBe("2026-04-15");
    expect(c.multi_agent_days).toBe(1); // peak ≥ 3
    expect(c.cross_project_days).toBe(1);
    expect(c.by_day).toHaveLength(7);
    expect(c.by_day[2]!.peak).toBe(4);
    expect(c.by_day[2]!.has_cross_project).toBe(true);
  });

  it("returns zero peaks for a quiet period", () => {
    const c = aggregateConcurrency([], period);
    expect(c.peak).toBe(0);
    expect(c.multi_agent_days).toBe(0);
    expect(c.cross_project_days).toBe(0);
  });
});
