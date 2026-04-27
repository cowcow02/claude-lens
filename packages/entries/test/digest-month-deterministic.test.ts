import { describe, expect, it } from "vitest";
import { buildDeterministicMonthDigest, mondaysInMonth } from "../src/digest-month.js";
import type { WeekDigest } from "../src/types.js";
import { CURRENT_WEEK_DIGEST_SCHEMA_VERSION } from "../src/types.js";

function mkWeek(overrides: Partial<WeekDigest>): WeekDigest {
  const base: WeekDigest = {
    version: CURRENT_WEEK_DIGEST_SCHEMA_VERSION,
    scope: "week", key: "2026-04-06",
    window: { start: "2026-04-06T00:00:00", end: "2026-04-12T23:59:59" },
    day_refs: [],
    generated_at: "2026-04-12T23:59:59Z",
    is_live: false, model: null, cost_usd: null,
    agent_min_total: 0, projects: [], shipped: [],
    outcome_mix: {}, helpfulness_sparkline: [null, null, null, null, null, null, null],
    top_flags: [], top_goal_categories: [], concurrency_peak_day: null,
    headline: null, trajectory: null, standout_days: null,
    friction_themes: null, suggestion: null,
  };
  return { ...base, ...overrides };
}

describe("mondaysInMonth", () => {
  it("returns ISO Mondays inside the month", () => {
    // April 2026: Mondays are 6, 13, 20, 27.
    expect(mondaysInMonth("2026-04")).toEqual([
      "2026-04-06", "2026-04-13", "2026-04-20", "2026-04-27",
    ]);
  });

  it("handles months that start on Monday", () => {
    // March 2026 starts on Sunday — first Monday is March 2.
    const mondays = mondaysInMonth("2026-03");
    expect(mondays[0]).toBe("2026-03-02");
    expect(mondays.length).toBeGreaterThanOrEqual(4);
  });
});

describe("buildDeterministicMonthDigest", () => {
  it("empty month yields zeroed digest", () => {
    const m = buildDeterministicMonthDigest("2026-04", []);
    expect(m.scope).toBe("month");
    expect(m.key).toBe("2026-04");
    expect(m.agent_min_total).toBe(0);
    expect(m.projects).toEqual([]);
    expect(m.headline).toBeNull();
  });

  it("sums agent_min across weeks", () => {
    const weeks = [
      mkWeek({ key: "2026-04-06", agent_min_total: 300 }),
      mkWeek({ key: "2026-04-13", agent_min_total: 200 }),
    ];
    const m = buildDeterministicMonthDigest("2026-04", weeks);
    expect(m.agent_min_total).toBe(500);
  });

  it("aggregates outcome_mix from week-level outcome_mix", () => {
    const weeks = [
      mkWeek({ key: "2026-04-06", outcome_mix: { shipped: 3, partial: 1 } }),
      mkWeek({ key: "2026-04-13", outcome_mix: { shipped: 2, blocked: 2 } }),
    ];
    const m = buildDeterministicMonthDigest("2026-04", weeks);
    expect(m.outcome_mix).toEqual({ shipped: 5, partial: 1, blocked: 2 });
  });

  it("aggregates shipped PRs with date attribution preserved", () => {
    const weeks = [
      mkWeek({
        key: "2026-04-06",
        shipped: [{ title: "phase 1", project: "x", date: "2026-04-08", session_id: "s1" }],
      }),
      mkWeek({
        key: "2026-04-13",
        shipped: [{ title: "phase 2", project: "x", date: "2026-04-15", session_id: "s2" }],
      }),
    ];
    const m = buildDeterministicMonthDigest("2026-04", weeks);
    expect(m.shipped).toHaveLength(2);
    expect(m.shipped[0].date).toBe("2026-04-08");
    expect(m.shipped[1].date).toBe("2026-04-15");
  });

  it("helpfulness_by_week takes the first non-null sparkline value per week", () => {
    const weeks = [
      mkWeek({
        key: "2026-04-06",
        helpfulness_sparkline: [null, "essential", "helpful", null, null, null, null],
      }),
      mkWeek({
        key: "2026-04-13",
        helpfulness_sparkline: [null, null, "neutral", null, null, null, null],
      }),
    ];
    const m = buildDeterministicMonthDigest("2026-04", weeks);
    expect(m.helpfulness_by_week).toEqual([
      { week_start: "2026-04-06", helpfulness: "essential" },
      { week_start: "2026-04-13", helpfulness: "neutral" },
      { week_start: "2026-04-20", helpfulness: null },
      { week_start: "2026-04-27", helpfulness: null },
    ]);
  });

  it("picks the week with highest concurrency_peak_day.peak", () => {
    const weeks = [
      mkWeek({ key: "2026-04-06", concurrency_peak_day: { date: "2026-04-08", peak: 4 } }),
      mkWeek({ key: "2026-04-13", concurrency_peak_day: { date: "2026-04-15", peak: 6 } }),
      mkWeek({ key: "2026-04-20", concurrency_peak_day: null }),
    ];
    const m = buildDeterministicMonthDigest("2026-04", weeks);
    expect(m.concurrency_peak_week).toEqual({ week_start: "2026-04-13", peak: 6 });
  });
});
