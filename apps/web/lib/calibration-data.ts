import "server-only";
import { cache } from "react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// Output of /tmp/calibrate2.py — pairs the daemon's real utilization with a
// JSONL-derived prediction at every snapshot's captured_at. Used as a
// proof-of-concept overlay on /usage to validate the calibration math
// before wiring it into the team server.
export type CalibrationPoint = {
  ts: string;
  real_5h: number | null;
  pred_5h: number;
  real_7d: number | null;
  pred_7d: number;
};

export type CalibrationDump = {
  coefs_5h: number[];
  coefs_7d: number[];
  curve: CalibrationPoint[];
};

export type PredictedSeriesByKey = {
  five_hour: { capturedAt: number; util: number }[];
  seven_day: { capturedAt: number; util: number }[];
  seven_day_sonnet: { capturedAt: number; util: number }[];
};

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

const CALIBRATION_PATH =
  process.env.CCLENS_CALIBRATION_DEBUG ||
  join(homedir(), ".cclens", "calibration-debug.json");

export const readCalibrationDump = cache((): CalibrationDump | null => {
  if (!existsSync(CALIBRATION_PATH)) return null;
  try {
    const raw = JSON.parse(readFileSync(CALIBRATION_PATH, "utf8"));
    if (!Array.isArray(raw?.curve)) return null;
    return raw as CalibrationDump;
  } catch {
    return null;
  }
});
