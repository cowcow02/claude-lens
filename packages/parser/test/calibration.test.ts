import { describe, it, expect } from "vitest";
import {
  buildPriorRateMap,
  buildSpendIndex,
  dollarsInRange,
  getAnchoredOpts,
  groupSnapsByCycle,
  predictAnchored,
  type CalibrationEvent,
  type CycleSnap,
  type SnapshotForCalibration,
} from "../src/calibration.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// Synthetic events evenly spaced across [start, end), priced to total
// `targetDollars` under sonnet rates ($3/M input).
function eventsCosting(startMs: number, endMs: number, targetDollars: number, n = 48): CalibrationEvent[] {
  if (n <= 0 || targetDollars <= 0) return [];
  const stride = (endMs - startMs) / n;
  const totalInputTokens = (targetDollars / 3) * 1_000_000;
  const perTurn = Math.max(1, Math.floor(totalInputTokens / n));
  const out: CalibrationEvent[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      ts: new Date(startMs + i * stride).toISOString(),
      family: "sonnet",
      input: perTurn,
      output: 0,
      cacheRead: 0,
      cache_1h: 0,
      cache_5m: 0,
    });
  }
  return out;
}

describe("buildSpendIndex / dollarsInRange", () => {
  it("matches a manual sum across windows", () => {
    const events = eventsCosting(1_000_000, 1_000_000 + DAY, 240); // ~$240 over a day
    const idx = buildSpendIndex(events);
    const total = dollarsInRange(idx, 0, Number.MAX_SAFE_INTEGER);
    expect(total).toBeCloseTo(240, 0);
    const half = dollarsInRange(idx, 1_000_000, 1_000_000 + DAY / 2);
    expect(half).toBeCloseTo(120, 0);
  });

  it("returns 0 for empty windows", () => {
    const idx = buildSpendIndex([]);
    expect(dollarsInRange(idx, 0, 1)).toBe(0);
  });
});

describe("groupSnapsByCycle", () => {
  it("groups snapshots by hour-rounded resets_at and sorts by ts", () => {
    const cycleEnd = Date.parse("2026-04-21T05:00:00Z");
    const snaps: SnapshotForCalibration[] = [
      { captured_at: "2026-04-15T10:00:00Z", seven_day: { utilization: 20, resets_at: new Date(cycleEnd).toISOString() } },
      { captured_at: "2026-04-14T10:00:00Z", seven_day: { utilization: 5, resets_at: new Date(cycleEnd).toISOString() } },
      { captured_at: "2026-04-15T10:00:00Z", seven_day: null },
    ];
    const groups = groupSnapsByCycle(snaps, (s) => s.seven_day);
    const arr = groups.get(cycleEnd);
    expect(arr).toBeDefined();
    expect(arr!.length).toBe(2);
    expect(arr![0]!.pct).toBe(5);
    expect(arr![1]!.pct).toBe(20);
  });
});

describe("predictAnchored", () => {
  const opts = getAnchoredOpts("7d", "pro-max-20x");

  it("returns the real value at snapshot times (anchor exactly)", () => {
    const cycleEnd = Date.parse("2026-04-21T05:00:00Z");
    const cycleStart = cycleEnd - 7 * DAY;
    const snaps: CycleSnap[] = [
      { ts: cycleStart, pct: 0 },
      { ts: cycleStart + 3 * DAY, pct: 30 },
      { ts: cycleStart + 6 * DAY, pct: 80 },
    ];
    const events = eventsCosting(cycleStart, cycleStart + 6 * DAY, 800, 100);
    const spend = buildSpendIndex(events);
    for (const s of snaps) {
      const p = predictAnchored(spend, snaps, new Map(), cycleEnd, 168, s.ts, opts);
      expect(p).toBeCloseTo(s.pct, 1);
    }
  });

  it("interpolates spend-weighted between two adjacent snaps", () => {
    const cycleEnd = Date.parse("2026-04-21T05:00:00Z");
    const cycleStart = cycleEnd - 7 * DAY;
    const a = { ts: cycleStart, pct: 0 };
    const b = { ts: cycleStart + 4 * DAY, pct: 40 };
    // Spend is back-loaded: $0 in first 3 days, then $400 over the last day.
    const events = eventsCosting(cycleStart + 3 * DAY, cycleStart + 4 * DAY, 400, 60);
    const spend = buildSpendIndex(events);
    const snaps = [a, b];
    // At day 3 (just before spending starts), $-fraction is 0 → predicted = pct_a.
    const tDay3 = cycleStart + 3 * DAY;
    const p3 = predictAnchored(spend, snaps, new Map(), cycleEnd, 168, tDay3, opts);
    expect(p3).toBeCloseTo(0, 0);
    // At halfway through the spending phase, $-fraction is 0.5 → predicted = 20.
    const tHalf = cycleStart + 3.5 * DAY;
    const pHalf = predictAnchored(spend, snaps, new Map(), cycleEnd, 168, tHalf, opts);
    expect(pHalf).toBeGreaterThan(15);
    expect(pHalf).toBeLessThan(25);
  });

  it("forward-extrapolates past the last snap using cycle rate when current cycle has travel", () => {
    const cycleEnd = Date.parse("2026-04-21T05:00:00Z");
    const cycleStart = cycleEnd - 7 * DAY;
    const lastSnapTs = cycleStart + 5 * DAY;
    const snaps: CycleSnap[] = [
      { ts: cycleStart, pct: 0 },
      { ts: lastSnapTs, pct: 50 },  // travel = 50pp, dominant
    ];
    // $500 spent during observation (gives $10/pp for current cycle)
    // then another $50 in the forward window — should add 5pp predicted.
    const events = [
      ...eventsCosting(cycleStart, lastSnapTs, 500, 100),
      ...eventsCosting(lastSnapTs, lastSnapTs + DAY, 50, 24),
    ];
    const spend = buildSpendIndex(events);
    const tForward = lastSnapTs + DAY;
    const p = predictAnchored(spend, snaps, new Map(), cycleEnd, 168, tForward, opts);
    // 50pp + ($50 / $10/pp) = 55pp
    expect(p).toBeGreaterThan(53);
    expect(p).toBeLessThan(57);
  });

  it("falls back to the prior median rate when current cycle has no travel", () => {
    const cycleEnd = Date.parse("2026-04-21T05:00:00Z");
    const cycleStart = cycleEnd - 7 * DAY;
    // Active cycle: only one snap, no travel observable yet.
    const snaps: CycleSnap[] = [{ ts: cycleStart + 60_000, pct: 0 }];

    // Two prior cycles, one closing at $20/pp, one at $10/pp — median is $15.
    const priorEnd1 = cycleStart - 7 * DAY;
    const priorStart1 = priorEnd1 - 7 * DAY;
    const priorEnd2 = priorEnd1;
    void priorEnd2;
    const priors = new Map<number, { rate: number; travel: number; dollars: number }>([
      [priorEnd1, { rate: 20, travel: 50, dollars: 1000 }],
      [priorEnd1 - 7 * DAY, { rate: 10, travel: 50, dollars: 500 }],
    ]);

    // Spent $30 since active cycle began.
    const events = eventsCosting(cycleStart + 60_000, cycleStart + DAY, 30, 24);
    void priorStart1;
    const spend = buildSpendIndex(events);
    const t = cycleStart + DAY;
    // With $15/pp rate and $30 spent → pred = 0 + 30/15 = 2pp.
    const p = predictAnchored(spend, snaps, priors, cycleEnd, 168, t, opts);
    expect(p).toBeGreaterThan(1.5);
    expect(p).toBeLessThan(2.5);
  });

  it("uses tier default when no current data and no priors", () => {
    const cycleEnd = Date.parse("2026-04-21T05:00:00Z");
    const cycleStart = cycleEnd - 7 * DAY;
    const events = eventsCosting(cycleStart, cycleStart + DAY, 24, 24);
    const spend = buildSpendIndex(events);
    const t = cycleStart + DAY;
    const p = predictAnchored(spend, [], new Map(), cycleEnd, 168, t, opts);
    // $24 / tierDefault $12 = 2pp
    expect(p).toBeCloseTo(2, 0);
  });
});

describe("buildPriorRateMap", () => {
  it("produces one rate per cycle with travel/spend metadata", () => {
    const cycleEnd = Date.parse("2026-04-21T05:00:00Z");
    const cycleStart = cycleEnd - 7 * DAY;
    const snaps: CycleSnap[] = [
      { ts: cycleStart, pct: 0 },
      { ts: cycleEnd - 60_000, pct: 50 },
    ];
    const events = eventsCosting(cycleStart, cycleEnd - 60_000, 500);
    const spend = buildSpendIndex(events);
    const groups = new Map<number, CycleSnap[]>([[cycleEnd, snaps]]);
    const priors = buildPriorRateMap(groups, spend);
    const info = priors.get(cycleEnd);
    expect(info).toBeDefined();
    expect(info!.rate).toBeCloseTo(10, 0); // $500 / 50pp = $10/pp
    expect(info!.travel).toBe(50);
    expect(info!.dollars).toBeCloseTo(500, 0);
  });

  it("skips cycles with non-positive travel or no spend", () => {
    const cycleEnd = Date.parse("2026-04-21T05:00:00Z");
    const cycleStart = cycleEnd - 7 * DAY;
    const flat: CycleSnap[] = [
      { ts: cycleStart, pct: 30 },
      { ts: cycleEnd - 60_000, pct: 30 },
    ];
    const groups = new Map<number, CycleSnap[]>([[cycleEnd, flat]]);
    const events = eventsCosting(cycleStart, cycleEnd, 500);
    const priors = buildPriorRateMap(groups, buildSpendIndex(events));
    expect(priors.size).toBe(0);
  });
});
