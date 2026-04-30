import { describe, it, expect } from "vitest";
import {
  computeUserRates,
  type CalibrationEvent,
  type SnapshotForCalibration,
} from "../src/calibration.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// Build a synthetic stream of assistant turns evenly spaced across [start, end)
// that costs `targetDollars` total under sonnet pricing (input only, since
// 1M input tokens at $3 = $3 -> easy to math out token count).
function eventsCosting(
  startMs: number,
  endMs: number,
  targetDollars: number,
): CalibrationEvent[] {
  const turns = 24;
  const stride = (endMs - startMs) / turns;
  const totalInputTokens = (targetDollars / 3) * 1_000_000;
  const perTurn = Math.floor(totalInputTokens / turns);
  const out: CalibrationEvent[] = [];
  for (let i = 0; i < turns; i++) {
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

// Two snapshots per cycle: one at the cycle start (matches the first
// observable event), one at the cycle close (matches closingPct). The
// cycleStartMs the fitter derives is `min(captured_at)`, so snapping at
// startMs exactly keeps the dollar-window equal to the full cycle.
function snapshotsForCycles(
  cycles: Array<{ startMs: number; endMs: number; closingPct: number }>,
): SnapshotForCalibration[] {
  const out: SnapshotForCalibration[] = [];
  for (const c of cycles) {
    out.push({
      captured_at: new Date(c.startMs).toISOString(),
      seven_day: { utilization: 0, resets_at: new Date(c.endMs).toISOString() },
    });
    out.push({
      captured_at: new Date(c.endMs).toISOString(),
      seven_day: { utilization: c.closingPct, resets_at: new Date(c.endMs).toISOString() },
    });
  }
  return out;
}

describe("computeUserRates", () => {
  const now = Date.parse("2026-04-30T00:00:00Z");

  it("returns the tier default when no completed cycles exist", () => {
    const out = computeUserRates([], [], "pro-max-20x", { now });
    expect(out.source7d).toBe("tier_default");
    expect(out.rate7d).toBe(12); // pro-max-20x default
    expect(out.cyclesUsed7d).toBe(0);
  });

  it("fits $/pp from a single completed cycle", () => {
    // One 7d cycle that ended 1 day ago, closed at 50%, with $600 spent.
    const cycleEnd = now - DAY;
    const cycleStart = cycleEnd - 7 * DAY;
    const events = eventsCosting(cycleStart, cycleEnd, 600);
    const snaps = snapshotsForCycles([{ startMs: cycleStart, endMs: cycleEnd, closingPct: 50 }]);

    const out = computeUserRates(events, snaps, "pro-max-20x", { now });
    expect(out.source7d).toBe("user_calibrated");
    expect(out.cyclesUsed7d).toBe(1);
    // $600 / 50pp = $12/pp. Allow tiny rounding from token math.
    expect(out.rate7d).toBeCloseTo(12, 1);
  });

  it("weights recent cycles more heavily than older ones", () => {
    // Three completed cycles ending 3, 2, 1 weeks ago.
    // Spends: $600/$60pp = $10/pp (oldest), $1200/60pp = $20/pp,
    //         $1500/60pp = $25/pp (newest).
    // Linear weights 1:2:3. Weighted avg = (10*1 + 20*2 + 25*3) / 6 = 125/6 ≈ 20.83.
    const e1 = now - 3 * 7 * DAY;
    const e2 = now - 2 * 7 * DAY;
    const e3 = now - 1 * 7 * DAY;
    const cycles = [
      { startMs: e1 - 7 * DAY, endMs: e1, closingPct: 60 },
      { startMs: e2 - 7 * DAY, endMs: e2, closingPct: 60 },
      { startMs: e3 - 7 * DAY, endMs: e3, closingPct: 60 },
    ];
    const events = [
      ...eventsCosting(cycles[0]!.startMs, cycles[0]!.endMs, 600),
      ...eventsCosting(cycles[1]!.startMs, cycles[1]!.endMs, 1200),
      ...eventsCosting(cycles[2]!.startMs, cycles[2]!.endMs, 1500),
    ];
    const snaps = snapshotsForCycles(cycles);

    const out = computeUserRates(events, snaps, "pro-max-20x", { now });
    expect(out.cyclesUsed7d).toBe(3);
    expect(out.rate7d).toBeCloseTo(125 / 6, 0);
  });

  it("ignores the in-progress cycle", () => {
    // Cycle that ends in the future is excluded.
    const futureEnd = now + DAY;
    const cycleStart = futureEnd - 7 * DAY;
    const events = eventsCosting(cycleStart, now, 300);
    const snaps: SnapshotForCalibration[] = [
      {
        captured_at: new Date(cycleStart + 60_000).toISOString(),
        seven_day: { utilization: 0, resets_at: new Date(futureEnd).toISOString() },
      },
      {
        captured_at: new Date(now - 60_000).toISOString(),
        seven_day: { utilization: 25, resets_at: new Date(futureEnd).toISOString() },
      },
    ];
    const out = computeUserRates(events, snaps, "pro-max-20x", { now });
    expect(out.source7d).toBe("tier_default");
    expect(out.cyclesUsed7d).toBe(0);
  });

  it("skips cycles with closingPct below the noise floor", () => {
    // Cycle closed at 2% — too low to give a reliable $/pp ratio.
    const cycleEnd = now - DAY;
    const cycleStart = cycleEnd - 7 * DAY;
    const events = eventsCosting(cycleStart, cycleEnd, 24);
    const snaps = snapshotsForCycles([{ startMs: cycleStart, endMs: cycleEnd, closingPct: 2 }]);
    const out = computeUserRates(events, snaps, "pro-max-20x", { now });
    expect(out.source7d).toBe("tier_default");
    expect(out.cyclesUsed7d).toBe(0);
  });

  it("skips cycles where the daemon missed the start", () => {
    // Daemon started 3 days into the cycle — first snap is far from cycle start.
    const cycleEnd = now - DAY;
    const cycleStart = cycleEnd - 7 * DAY;
    const events = eventsCosting(cycleStart, cycleEnd, 600);
    const snaps: SnapshotForCalibration[] = [
      {
        // First snap 3 days late — outside the 5%-of-7d (~8.4h) tolerance.
        captured_at: new Date(cycleStart + 3 * DAY).toISOString(),
        seven_day: { utilization: 30, resets_at: new Date(cycleEnd).toISOString() },
      },
      {
        captured_at: new Date(cycleEnd - 60_000).toISOString(),
        seven_day: { utilization: 50, resets_at: new Date(cycleEnd).toISOString() },
      },
    ];
    const out = computeUserRates(events, snaps, "pro-max-20x", { now });
    expect(out.source7d).toBe("tier_default");
    expect(out.cyclesUsed7d).toBe(0);
  });
});
