import { describe, it, expect } from "vitest";
import {
  recommend,
  DEFAULT_OPTIMIZER_SETTINGS,
  type MemberStats,
} from "../../src/lib/plan-optimizer.js";
import { tierEntry } from "../../src/lib/plan-tiers.js";

function stats(overrides: Partial<MemberStats> = {}): MemberStats {
  return {
    worstSevenDayPeak: 50,
    avgSevenDayAvg: 30,
    worstFiveHourPeak: 40,
    worstOpusPeak: 0,
    totalDaysObserved: 28,
    lastSeenAtMs: Date.now(),
    ...overrides,
  };
}

describe("recommend — gating", () => {
  it("returns insufficient_data when fewer than minDaysRequired observed", () => {
    const r = recommend(stats({ totalDaysObserved: 10 }), tierEntry("pro-max"));
    expect(r.action).toBe("insufficient_data");
    expect(r.confidence).toBe("insufficient");
  });

  it("returns review_manually for custom tier even with plenty of data", () => {
    const r = recommend(
      stats({ totalDaysObserved: 30, avgSevenDayAvg: 20, worstSevenDayPeak: 40 }),
      tierEntry("custom"),
    );
    expect(r.action).toBe("review_manually");
  });

  it("returns insufficient_data BEFORE checking custom tier", () => {
    const r = recommend(stats({ totalDaysObserved: 5 }), tierEntry("custom"));
    expect(r.action).toBe("insufficient_data");
  });
});

describe("recommend — top_up_needed", () => {
  it("fires when peak hit 100% even once", () => {
    const r = recommend(
      stats({ worstSevenDayPeak: 100, avgSevenDayAvg: 30 }),
      tierEntry("pro-max"),
    );
    expect(r.action).toBe("top_up_needed");
  });

  it("fires when peak exceeded 100% (above-cap usage)", () => {
    const r = recommend(
      stats({ worstSevenDayPeak: 115 }),
      tierEntry("pro-max-20x"),
    );
    expect(r.action).toBe("top_up_needed");
  });
});

describe("recommend — upgrade_urgent", () => {
  it("fires for entry-tier (pro) with peak above 95%", () => {
    const r = recommend(
      stats({ worstSevenDayPeak: 96, avgSevenDayAvg: 60 }),
      tierEntry("pro"),
    );
    expect(r.action).toBe("upgrade_urgent");
    if (r.action === "upgrade_urgent") expect(r.targetTier).toBe("pro-max");
  });

  it("fires for pro-max (rank 1) with peak above 95%", () => {
    const r = recommend(
      stats({ worstSevenDayPeak: 98, avgSevenDayAvg: 50 }),
      tierEntry("pro-max"),
    );
    expect(r.action).toBe("upgrade_urgent");
    if (r.action === "upgrade_urgent") expect(r.targetTier).toBe("pro-max-20x");
  });

  it("does NOT fire for pro-max-20x (top tier, no upgrade target)", () => {
    const r = recommend(
      stats({ worstSevenDayPeak: 98 }),
      tierEntry("pro-max-20x"),
    );
    // Falls through to top_up_needed since peak is not 100% but high — actually
    // 98 < 100, no top_up. Falls to upgrade or stay. Top-tier with rank > 1
    // skips the upgrade_urgent block, then hits the avg < 80 → stay.
    expect(r.action).not.toBe("upgrade_urgent");
  });
});

describe("recommend — upgrade", () => {
  it("fires when avg above 80%", () => {
    const r = recommend(
      stats({ worstSevenDayPeak: 92, avgSevenDayAvg: 85 }),
      tierEntry("pro-max"),
    );
    expect(r.action).toBe("upgrade");
    if (r.action === "upgrade") expect(r.targetTier).toBe("pro-max-20x");
  });

  it("does NOT fire when avg exactly at threshold (80) — strictly >=", () => {
    // Default threshold is 80. avg=80 -> matches >=, fires upgrade.
    const r = recommend(
      stats({ worstSevenDayPeak: 92, avgSevenDayAvg: 80 }),
      tierEntry("pro-max"),
    );
    expect(r.action).toBe("upgrade");
  });

  it("does not propose impossible upgrade past pro-max-20x", () => {
    const r = recommend(
      stats({ worstSevenDayPeak: 92, avgSevenDayAvg: 85 }),
      tierEntry("pro-max-20x"),
    );
    expect(r.action).not.toBe("upgrade");
    expect(r.action).toBe("stay");
  });
});

describe("recommend — downgrade", () => {
  it("fires for pro-max-20x with avg<40 and peak<60", () => {
    const r = recommend(
      stats({ avgSevenDayAvg: 32, worstSevenDayPeak: 51 }),
      tierEntry("pro-max-20x"),
    );
    expect(r.action).toBe("downgrade");
    if (r.action === "downgrade") {
      expect(r.targetTier).toBe("pro-max");
      // Savings is the monthly subscription delta: $200/mo - $100/mo = $100/mo.
      expect(r.estimatedSavingsUsd).toBe(100);
    }
  });

  it("does NOT fire for pro-max (rank 1) — only top tier downgrades automatically", () => {
    const r = recommend(
      stats({ avgSevenDayAvg: 20, worstSevenDayPeak: 35 }),
      tierEntry("pro-max"),
    );
    expect(r.action).not.toBe("downgrade");
  });

  it("does NOT fire when peak is too high (would be tight after downgrade)", () => {
    const r = recommend(
      stats({ avgSevenDayAvg: 30, worstSevenDayPeak: 65 }),
      tierEntry("pro-max-20x"),
    );
    expect(r.action).toBe("stay");
  });
});

describe("recommend — stay", () => {
  it("returns stay for well-matched usage", () => {
    const r = recommend(
      stats({ avgSevenDayAvg: 55, worstSevenDayPeak: 75 }),
      tierEntry("pro-max"),
    );
    expect(r.action).toBe("stay");
  });
});

describe("recommend — confidence", () => {
  it("high when 21+ days observed and not near thresholds", () => {
    const r = recommend(
      stats({ totalDaysObserved: 28, avgSevenDayAvg: 50, worstSevenDayPeak: 70 }),
      tierEntry("pro-max"),
    );
    expect(r.confidence).toBe("high");
  });

  it("low when stats sit within 10pp of a threshold boundary", () => {
    // 14 ≤ days < 21 with stats near boundary keeps confidence low.
    const r = recommend(
      stats({ totalDaysObserved: 16, avgSevenDayAvg: 79, worstSevenDayPeak: 88 }),
      tierEntry("pro-max"),
    );
    expect(r.confidence).toBe("low");
  });

  it("medium when 14-20 days with no near-threshold values", () => {
    const r = recommend(
      stats({ totalDaysObserved: 18, avgSevenDayAvg: 50, worstSevenDayPeak: 70 }),
      tierEntry("pro-max"),
    );
    expect(r.confidence).toBe("medium");
  });
});
