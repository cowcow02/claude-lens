import "server-only";
import { cache } from "react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { loadCalibrationCurve } from "@claude-lens/parser/fs";
import type { PlanTier } from "@claude-lens/parser";

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
  tier?: string;
};

export type PredictedSeriesByKey = {
  five_hour: { capturedAt: number; util: number }[];
  seven_day: { capturedAt: number; util: number }[];
  seven_day_sonnet: { capturedAt: number; util: number }[];
};

// One-line summary of the most recently *completed* cycle, ready to render
// on the dashboard or a team-edition member card. `source: "real"` means
// the daemon covered the whole cycle and we report the observed peak.
// `source: "predicted"` means the cycle predates daemon data and we fall
// back to the JSONL-derived prediction (cold-start path).
export type LastCycleSummary = {
  windowLabel: "5h" | "7d";
  peakPct: number;
  source: "real" | "predicted";
  endsAt: string;        // ISO timestamp the cycle ended at
  startedAt: string;     // ISO timestamp the cycle began at
};

// For each window, find the most recently *ended* cycle and report its
// peak utilization. Cycles are bucketed by `cycle_end_*` (= snapshot's
// resets_at) which is authoritative; the predicted curve alone can't
// always tell cycle boundaries apart from data drops. Real data wins
// when available; predicted is the cold-start fallback.
export function lastCompletedCycleSummary(
  dump: CalibrationDump | null,
): { five_hour: LastCycleSummary | null; seven_day: LastCycleSummary | null } {
  const empty = { five_hour: null, seven_day: null };
  if (!dump || dump.curve.length < 2) return empty;
  const curve = dump.curve;

  function summarise(
    predKey: "pred_5h" | "pred_7d",
    realKey: "real_5h" | "real_7d",
    cycleKey: "cycle_end_5h" | "cycle_end_7d",
    windowLabel: "5h" | "7d",
  ): LastCycleSummary | null {
    const nowMs = Date.now();
    // Anthropic's resets_at jitters by milliseconds across snapshots in
    // the same cycle (e.g. 19:00:00.495 vs 19:00:00.881). Hour-round the
    // bucket key so all snapshots in one cycle land in the same bucket.
    const HOUR = 3_600_000;
    const byCycle = new Map<number, typeof curve>();
    for (const p of curve) {
      const k = p[cycleKey];
      if (!k) continue;
      const ms = Date.parse(k);
      if (Number.isNaN(ms)) continue;
      const bucket = Math.round(ms / HOUR) * HOUR;
      const arr = byCycle.get(bucket) ?? [];
      arr.push(p);
      byCycle.set(bucket, arr);
    }
    if (byCycle.size === 0) return null;

    const completedKeys = Array.from(byCycle.keys())
      .filter((k) => k <= nowMs)
      .sort((a, b) => a - b);
    if (completedKeys.length === 0) return null;
    const lastKey = completedKeys[completedKeys.length - 1]!;
    const slice = byCycle.get(lastKey)!;
    if (slice.length === 0) return null;

    let peak = 0;
    let source: "real" | "predicted" = "predicted";
    for (const p of slice) {
      const r = p[realKey];
      if (typeof r === "number" && r > peak) {
        peak = r;
        source = "real";
      }
    }
    if (source === "predicted") {
      for (const p of slice) {
        const v = p[predKey] ?? 0;
        if (v > peak) peak = v;
      }
    }

    return {
      windowLabel,
      peakPct: Math.round(peak * 10) / 10,
      source,
      startedAt: slice[0]!.ts,
      endsAt: new Date(lastKey).toISOString(),
    };
  }

  return {
    five_hour: summarise("pred_5h", "real_5h", "cycle_end_5h", "5h"),
    seven_day: summarise("pred_7d", "real_7d", "cycle_end_7d", "7d"),
  };
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
    const t = raw?.planTier as PlanTier | undefined;
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
      tier: result.tier,
    };
  },
);
