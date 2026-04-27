import { describe, expect, it } from "vitest";
import {
  calendarWeek, priorCalendarWeek, last4CompletedWeeks,
  calendarMonth, priorCalendarMonth, aggregateConcurrency,
} from "../src/aggregate.js";
import type { ParallelismBurst } from "../src/analytics.js";

const SUNDAY    = new Date(2026, 3, 26); // 2026-04-26 Sun
const WEDNESDAY = new Date(2026, 3, 22); // 2026-04-22 Wed
const MONDAY    = new Date(2026, 3, 20); // 2026-04-20 Mon
const APR_15TH  = new Date(2026, 3, 15);

describe("calendarWeek", () => {
  it("returns Mon-Sun bracketing a Wednesday", () => {
    const r = calendarWeek(WEDNESDAY);
    expect(r.start.toDateString()).toBe(MONDAY.toDateString());
    expect(r.end.toDateString()).toBe(SUNDAY.toDateString());
  });

  it("returns Mon-Sun when ref IS Sunday (still part of that week)", () => {
    const r = calendarWeek(SUNDAY);
    expect(r.start.toDateString()).toBe(MONDAY.toDateString());
    expect(r.end.toDateString()).toBe(SUNDAY.toDateString());
  });

  it("returns Mon-Sun when ref IS Monday (new week starts here)", () => {
    const r = calendarWeek(MONDAY);
    expect(r.start.toDateString()).toBe(MONDAY.toDateString());
    expect(r.end.toDateString()).toBe(SUNDAY.toDateString());
  });
});

describe("priorCalendarWeek", () => {
  it("returns the week before the one containing ref", () => {
    const r = priorCalendarWeek(WEDNESDAY); // week of Apr 20–26
    expect(r.start.toDateString()).toBe(new Date(2026, 3, 13).toDateString());
    expect(r.end.toDateString()).toBe(new Date(2026, 3, 19).toDateString());
  });
});

describe("last4CompletedWeeks", () => {
  it("ends on the most recent Sunday and spans 28 days back", () => {
    const r = last4CompletedWeeks(WEDNESDAY); // current week is Apr 20–26 → last completed is Apr 13–19
    expect(r.end.toDateString()).toBe(new Date(2026, 3, 19).toDateString());
    const span = (r.end.getTime() - r.start.getTime()) / 86_400_000;
    expect(Math.round(span)).toBe(27); // inclusive 28-day window has 27 daily intervals
    expect(r.start.toDateString()).toBe(new Date(2026, 2, 23).toDateString());
  });
});

describe("calendarMonth", () => {
  it("returns first to last day of ref's month", () => {
    const r = calendarMonth(APR_15TH);
    expect(r.start.toDateString()).toBe(new Date(2026, 3, 1).toDateString());
    expect(r.end.toDateString()).toBe(new Date(2026, 3, 30).toDateString());
  });

  it("handles February (28 days in 2026, non-leap)", () => {
    const feb = new Date(2026, 1, 14);
    const r = calendarMonth(feb);
    expect(r.start.toDateString()).toBe(new Date(2026, 1, 1).toDateString());
    expect(r.end.toDateString()).toBe(new Date(2026, 1, 28).toDateString());
  });
});

describe("priorCalendarMonth", () => {
  it("returns the month before ref's", () => {
    const r = priorCalendarMonth(APR_15TH);
    expect(r.start.toDateString()).toBe(new Date(2026, 2, 1).toDateString());
    expect(r.end.toDateString()).toBe(new Date(2026, 2, 31).toDateString());
  });

  it("crosses year boundary correctly", () => {
    const jan = new Date(2026, 0, 14);
    const r = priorCalendarMonth(jan);
    expect(r.start.toDateString()).toBe(new Date(2025, 11, 1).toDateString());
    expect(r.end.toDateString()).toBe(new Date(2025, 11, 31).toDateString());
  });
});

describe("aggregateConcurrency", () => {
  function burst(startMs: number, endMs: number, peak: number, crossProject = false): ParallelismBurst {
    return {
      startMs, endMs, peak, crossProject,
      sessions: [],
    };
  }

  it("buckets bursts by their start day and tracks per-day peak + cross-project flag", () => {
    const monStart = new Date(2026, 3, 20, 10, 0).getTime();
    const wedStart = new Date(2026, 3, 22, 14, 0).getTime();
    const bursts = [
      burst(monStart, monStart + 5 * 60_000, 2),
      burst(wedStart, wedStart + 8 * 60_000, 4, true),
      burst(wedStart + 30 * 60_000, wedStart + 35 * 60_000, 3),
    ];
    const period = { start: MONDAY, end: SUNDAY };
    const r = aggregateConcurrency(bursts, period);

    expect(r.by_day).toHaveLength(7);
    const byDate = new Map(r.by_day.map(d => [d.date, d]));
    expect(byDate.get("2026-04-20")?.peak).toBe(2);
    expect(byDate.get("2026-04-22")?.peak).toBe(4);
    expect(byDate.get("2026-04-22")?.has_cross_project).toBe(true);
    expect(byDate.get("2026-04-21")?.peak).toBe(0);
  });

  it("returns peak + peak_day across the window", () => {
    const monStart = new Date(2026, 3, 20, 10, 0).getTime();
    const wedStart = new Date(2026, 3, 22, 14, 0).getTime();
    const bursts = [
      burst(monStart, monStart + 5 * 60_000, 2),
      burst(wedStart, wedStart + 8 * 60_000, 5, true),
    ];
    const r = aggregateConcurrency(bursts, { start: MONDAY, end: SUNDAY });
    expect(r.peak).toBe(5);
    expect(r.peak_day).toBe("2026-04-22");
  });

  it("counts multi-agent (peak ≥ 3) and cross-project days", () => {
    const monStart = new Date(2026, 3, 20, 10, 0).getTime();
    const tueStart = new Date(2026, 3, 21, 10, 0).getTime();
    const wedStart = new Date(2026, 3, 22, 10, 0).getTime();
    const bursts = [
      burst(monStart, monStart + 60_000, 2),       // not multi-agent
      burst(tueStart, tueStart + 60_000, 3, true), // multi-agent + cross-project
      burst(wedStart, wedStart + 60_000, 4),       // multi-agent
    ];
    const r = aggregateConcurrency(bursts, { start: MONDAY, end: SUNDAY });
    expect(r.multi_agent_days).toBe(2);
    expect(r.cross_project_days).toBe(1);
  });

  it("returns zeros when no bursts overlap the period", () => {
    const r = aggregateConcurrency([], { start: MONDAY, end: SUNDAY });
    expect(r.peak).toBe(0);
    expect(r.peak_day).toBeUndefined();
    expect(r.multi_agent_days).toBe(0);
    expect(r.cross_project_days).toBe(0);
    expect(r.by_day).toHaveLength(7);
  });
});
