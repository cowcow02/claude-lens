import { describe, it, expect } from "vitest";
import {
  computeBurndown,
  type MemberLatestSnapshot,
} from "../../src/lib/capacity-burndown.js";

const NOW = Date.parse("2026-04-22T12:00:00.000Z");

function snap(overrides: Partial<MemberLatestSnapshot> = {}): MemberLatestSnapshot {
  return {
    membershipId: "m1",
    memberName: "Alice",
    tierKey: "pro-max",
    sevenDayUtilization: 50,
    // 50% through window: window started 3.5 days ago, resets 3.5 days from now.
    sevenDayResetsAt: new Date(NOW + 3.5 * 86_400_000),
    capturedAt: new Date(NOW),
    ...overrides,
  };
}

describe("computeBurndown — empty / custom-only", () => {
  it("returns info-zero for empty input", () => {
    const r = computeBurndown([], NOW);
    expect(r.level).toBe("info");
    expect(r.currentSpendUsd).toBe(0);
    expect(r.capUsd).toBe(0);
  });

  it("excludes custom-tier members", () => {
    const r = computeBurndown([snap({ tierKey: "custom" })], NOW);
    expect(r.level).toBe("info");
    expect(r.capUsd).toBe(0);
  });
});

describe("computeBurndown — spend math", () => {
  it("sums per-member contribution as utilization% * weekly_limit_usd", () => {
    const r = computeBurndown(
      [
        snap({ tierKey: "pro-max-20x", sevenDayUtilization: 50 }),     // $100
        snap({ tierKey: "pro-max", sevenDayUtilization: 30, memberName: "Bob" }), // $30
      ],
      NOW,
    );
    expect(r.currentSpendUsd).toBeCloseTo(130, 2);
    expect(r.capUsd).toBe(300); // 200 + 100
  });

  it("treats null utilization as zero contribution", () => {
    const r = computeBurndown(
      [snap({ sevenDayUtilization: null })],
      NOW,
    );
    expect(r.currentSpendUsd).toBe(0);
    expect(r.capUsd).toBe(100);
  });
});

describe("computeBurndown — projection thresholds", () => {
  it("YELLOW when projection lands 85-100% of cap and window not too far in", () => {
    // 50% utilization at 50% window elapsed → on-track for ~100%. Yellow.
    // Need to be slightly under 100% projection to avoid red and slightly under
    // 0.7 fraction. Set window 60% elapsed and current spend such that
    // projected = 90% of cap.
    const fractionElapsed = 0.6;
    const memberA = snap({
      tierKey: "pro-max-20x",
      sevenDayUtilization: 54, // (54% of 200) / 0.6 = 180 / 0.6 = $180; cap $200, projection = 90%
      sevenDayResetsAt: new Date(NOW + (1 - fractionElapsed) * 7 * 86_400_000),
    });
    const r = computeBurndown([memberA], NOW);
    expect(r.level).toBe("yellow");
    expect(r.projectedEndOfWindowUsd).toBeCloseTo(180, 0);
  });

  it("RED when projection exceeds 100% of cap and window not too far in", () => {
    const fractionElapsed = 0.5;
    // 80% utilization at 50% window → on track for 160%. Red.
    const memberA = snap({
      tierKey: "pro-max",
      sevenDayUtilization: 80,
      sevenDayResetsAt: new Date(NOW + (1 - fractionElapsed) * 7 * 86_400_000),
    });
    const r = computeBurndown([memberA], NOW);
    expect(r.level).toBe("red");
    expect(r.projectedEndOfWindowUsd).toBeGreaterThan(r.capUsd);
  });

  it("INFO when window is too far elapsed for projection to matter (red gate)", () => {
    // 95% elapsed, 110% projected — still over cap, but window almost done.
    const fractionElapsed = 0.95;
    const memberA = snap({
      tierKey: "pro-max",
      sevenDayUtilization: 105,
      sevenDayResetsAt: new Date(NOW + (1 - fractionElapsed) * 7 * 86_400_000),
    });
    const r = computeBurndown([memberA], NOW);
    expect(r.level).not.toBe("red");
  });

  it("INFO (no projection) when window has barely started", () => {
    const fractionElapsed = 0.05; // 5% in — too noisy to project
    const memberA = snap({
      sevenDayUtilization: 90,
      sevenDayResetsAt: new Date(NOW + (1 - fractionElapsed) * 7 * 86_400_000),
    });
    const r = computeBurndown([memberA], NOW);
    expect(r.projectedEndOfWindowUsd).toBeNull();
    expect(r.level).toBe("info");
  });
});

describe("computeBurndown — window math", () => {
  it("approxDaysRemaining decreases as fraction elapsed grows", () => {
    const half = computeBurndown(
      [snap({ sevenDayResetsAt: new Date(NOW + 3.5 * 86_400_000) })],
      NOW,
    );
    expect(half.avgWindowFractionElapsed).toBeCloseTo(0.5, 2);
    expect(half.approxDaysRemaining).toBeCloseTo(3.5, 1);
  });

  it("averages window fraction across members with different reset days", () => {
    const r = computeBurndown(
      [
        snap({ sevenDayResetsAt: new Date(NOW + 1 * 86_400_000) }),    // 6/7 elapsed
        snap({
          sevenDayResetsAt: new Date(NOW + 6 * 86_400_000),             // 1/7 elapsed
          memberName: "Bob",
        }),
      ],
      NOW,
    );
    expect(r.avgWindowFractionElapsed).toBeCloseTo(0.5, 2);
  });
});

describe("computeBurndown — top contributors", () => {
  it("sorts members by contribution descending and trims to top 3", () => {
    const members: MemberLatestSnapshot[] = [
      snap({ memberName: "Alice", tierKey: "pro-max", sevenDayUtilization: 30 }),  // 30
      snap({ memberName: "Bob", tierKey: "pro-max-20x", sevenDayUtilization: 80 }), // 160
      snap({ memberName: "Carol", tierKey: "pro", sevenDayUtilization: 50 }),       // 10
      snap({ memberName: "Dan", tierKey: "pro-max-20x", sevenDayUtilization: 40 }), // 80
    ];
    const r = computeBurndown(members, NOW);
    expect(r.topContributors).toHaveLength(3);
    expect(r.topContributors[0].memberName).toBe("Bob");
    expect(r.topContributors[1].memberName).toBe("Dan");
    expect(r.topContributors[2].memberName).toBe("Alice");
  });
});
