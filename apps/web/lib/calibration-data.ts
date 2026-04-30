import "server-only";
import { cache } from "react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadCalibrationCurve } from "@claude-lens/parser/fs";
import type { PlanTier, RateSource } from "@claude-lens/parser";

// One point on the calibration overlay — pairs the daemon's measured
// utilization (when a snapshot landed in the slot) with the JSONL-derived
// prediction. Used by the /usage burndown overlay and by the Calibration
// Check chart.
export type CalibrationPoint = {
  ts: string;
  real_5h: number | null;
  pred_5h: number;
  real_7d: number | null;
  pred_7d: number;
  /** ISO `resets_at` for the cycle this point belongs to. Lets the
   * summary helper bucket points into cycles without sniffing for
   * value drops. May be null for cold-start back-fill that lands
   * before any known reset. */
  cycle_end_5h?: string | null;
  cycle_end_7d?: string | null;
};

export type CalibrationDump = {
  curve: CalibrationPoint[];
  // Older Python dumps had per-feature coefficients; the $-rate predictor
  // doesn't, so these are optional. Kept around so existing chart code
  // that may inspect them doesn't crash on undefined.
  coefs_5h?: number[];
  coefs_7d?: number[];
  rate_per_pct?: number;
  rate_per_pct_5h?: number;
  rate_per_pct_7d?: number;
  rate_source_5h?: RateSource;
  rate_source_7d?: RateSource;
  cycles_used_5h?: number;
  cycles_used_7d?: number;
  tier?: string;
};

export type PredictedSeriesByKey = {
  five_hour: { capturedAt: number; util: number }[];
  seven_day: { capturedAt: number; util: number }[];
  seven_day_sonnet: { capturedAt: number; util: number }[];
};

// History of recent cycles for trend visuals. Each entry is one full cycle
// the user lived through — `current: true` flags the live (in-progress)
// cycle, the rest are completed. `source: "real"` = daemon observed the
// peak, `source: "predicted"` = cycle predates daemon data and we fall
// back to the JSONL-derived prediction (cold-start path).
export type CyclePeak = {
  endsAt: string;
  peakPct: number;
  source: "real" | "predicted";
  current: boolean;
};

// Per-cycle peak history for a single window (5h or 7d). Used by the
// dashboard's "previous cycles" trend strip — humans understand "last 4
// weeks: 86%, 92%, 44%, 34% (current)" much better than a single number.
// Limited to the last `maxCycles` (most recent) so the visual stays compact.
export function previousCyclesTrend(
  dump: CalibrationDump | null,
  window: "5h" | "7d",
  maxCycles = 6,
): CyclePeak[] {
  if (!dump || dump.curve.length < 2) return [];
  const HOUR = 3_600_000;
  const cycleKey: "cycle_end_5h" | "cycle_end_7d" = window === "5h" ? "cycle_end_5h" : "cycle_end_7d";
  const predKey: "pred_5h" | "pred_7d" = window === "5h" ? "pred_5h" : "pred_7d";
  const realKey: "real_5h" | "real_7d" = window === "5h" ? "real_5h" : "real_7d";

  // Hour-round the cycle key so millisecond-jittered resets collapse.
  const byCycle = new Map<number, typeof dump.curve>();
  for (const p of dump.curve) {
    const k = p[cycleKey];
    if (!k) continue;
    const ms = Date.parse(k);
    if (Number.isNaN(ms)) continue;
    const bucket = Math.round(ms / HOUR) * HOUR;
    const arr = byCycle.get(bucket) ?? [];
    arr.push(p);
    byCycle.set(bucket, arr);
  }

  const nowMs = Date.now();
  const cycles: CyclePeak[] = [];
  for (const [endMs, points] of Array.from(byCycle.entries()).sort((a, b) => a[0] - b[0])) {
    // Take the max across BOTH real and predicted — when the daemon goes
    // dark before cycle close, predicted forward-extrapolation often
    // exceeds the last observed value, and the cycle's true peak is the
    // predicted close, not the last poll. `source` reflects which side won.
    let peak = 0;
    let source: "real" | "predicted" = "predicted";
    for (const p of points) {
      const r = p[realKey];
      if (typeof r === "number" && r > peak) { peak = r; source = "real"; }
      const v = p[predKey] ?? 0;
      if (v > peak) { peak = v; source = "predicted"; }
    }
    cycles.push({
      endsAt: new Date(endMs).toISOString(),
      peakPct: Math.round(peak * 10) / 10,
      source,
      current: endMs > nowMs,
    });
  }
  return cycles.slice(-maxCycles);
}

// Converts the calibration dump into the same shape UsageChart expects to
// overlay on each burndown plot. seven_day_sonnet has no predictor today
// so it returns empty — the chart will simply not show an estimate line.
export function predictedSeriesFor(dump: CalibrationDump | null): PredictedSeriesByKey {
  if (!dump) return { five_hour: [], seven_day: [], seven_day_sonnet: [] };
  const five_hour = dump.curve
    .filter((c) => Number.isFinite(c.pred_5h))
    .map((c) => ({ capturedAt: new Date(c.ts).getTime(), util: Math.max(0, c.pred_5h) }));
  const seven_day = dump.curve
    .filter((c) => Number.isFinite(c.pred_7d))
    .map((c) => ({ capturedAt: new Date(c.ts).getTime(), util: Math.max(0, c.pred_7d) }));
  return { five_hour, seven_day, seven_day_sonnet: [] };
}

// Default tier when we can't infer the user's subscription from anywhere.
// /api/oauth/profile auto-detects this on each daemon push but for cold
// start we fall back to the heaviest tier so cold-start back-fill predicts
// the longest possible windows. The profile cache lives next to the JSON
// dump and is read below if available.
const PROFILE_CACHE = join(homedir(), ".cclens", "profile.json");
const DEFAULT_TIER: PlanTier = "pro-max-20x";

function readTier(): PlanTier {
  if (!existsSync(PROFILE_CACHE)) return DEFAULT_TIER;
  try {
    const raw = JSON.parse(readFileSync(PROFILE_CACHE, "utf8"));
    // Cache shape from writeCachedProfile: { fetchedAtMs, profile: { planTier, ... } }.
    const t = raw?.profile?.planTier as PlanTier | undefined;
    if (t === "pro" || t === "pro-max" || t === "pro-max-20x" || t === "custom") return t;
  } catch {
    /* ignore — fall back to default */
  }
  return DEFAULT_TIER;
}

// Computed live from JSONL transcripts + ~/.cclens/usage.jsonl, replacing
// the Python sidecar that previously wrote ~/.cclens/calibration-debug.json.
// The walk is heavy on first call but cached at multiple levels (parser's
// mtime cache + React's per-request `cache()`).
export const readCalibrationDump = cache(
  async (): Promise<CalibrationDump | null> => {
    const tier = readTier();
    const result = await loadCalibrationCurve(tier);
    if (!result) return null;
    return {
      curve: result.curve,
      rate_per_pct: result.rate_per_pct,
      rate_per_pct_5h: result.rate_per_pct_5h,
      rate_per_pct_7d: result.rate_per_pct_7d,
      rate_source_5h: result.rate_source_5h,
      rate_source_7d: result.rate_source_7d,
      cycles_used_5h: result.cycles_used_5h,
      cycles_used_7d: result.cycles_used_7d,
      tier: result.tier,
    };
  },
);
