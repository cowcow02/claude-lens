// Pure calibration math — no fs, no network. The Node-only loaders live in
// fs.ts. Splitting them keeps the team-server (which also wants per-member
// $-from-tokens math but reads from Postgres, not local JSONL) able to
// import this module without dragging in node:fs.

export type ModelFamily = "sonnet" | "opus" | "haiku";

export type CalibrationEvent = {
  ts: string;             // ISO timestamp (assistant turn timestamp)
  family: ModelFamily;    // model family for pricing
  input: number;
  output: number;
  cacheRead: number;
  cache_1h: number;
  cache_5m: number;
};

export type PlanTier = "pro" | "pro-max" | "pro-max-20x" | "custom";

// $ per 1M tokens, calibrated against ccusage CLI output (regressed from
// per-model single-day rows). ccusage doesn't break out 1h vs 5m cache
// writes — it uses one rate for both — so we mirror that here. Note that
// these don't always match Anthropic's published list prices: ccusage
// (via LiteLLM) maps claude-opus-4-{6,7} to a legacy rate that's 1/3 of
// the published Opus rate. Matching ccusage is the goal because that's
// what users compare against.
export const PRICES: Record<ModelFamily, { input: number; output: number; cacheRead: number; cache_1h: number; cache_5m: number }> = {
  sonnet: { input: 3.0, output: 15.0, cacheRead: 0.3, cache_1h: 3.75, cache_5m: 3.75 },
  opus:   { input: 5.0, output: 25.0, cacheRead: 0.5, cache_1h: 6.25, cache_5m: 6.25 },
  haiku:  { input: 1.0, output: 5.0,  cacheRead: 0.1, cache_1h: 1.25, cache_5m: 1.25 },
};

// $ per 1% utilization, by plan tier and window. Pro Max 20x derived
// empirically: healthy 7d cycles cluster at $11-$13/% (median $12), and
// healthy 5h cycles cluster at $1.6-$3/% (median ~$2). The two windows
// have very different rates because the 5h limit is a fraction of the
// 7d limit — using one rate for both produces 5-6x errors on 5h bursts.
//
// Other tiers are scaled by their subscription value multipliers; they
// need daemon-collected data to validate properly but are reasonable
// cold-start defaults.
export const RATE_PER_PCT_7D: Record<PlanTier, number> = {
  "pro": 1.2,
  "pro-max": 2.4,
  "pro-max-20x": 12.0,
  "custom": 12.0,
};
export const RATE_PER_PCT_5H: Record<PlanTier, number> = {
  "pro": 0.2,
  "pro-max": 0.4,
  "pro-max-20x": 2.0,
  "custom": 2.0,
};
// Back-compat alias used by older call sites — defaults to the 7d rate.
export const RATE_PER_PCT = RATE_PER_PCT_7D;

export function modelFamily(modelStr: string | undefined | null): ModelFamily | null {
  const m = (modelStr ?? "").toLowerCase();
  if (!m || m === "<synthetic>") return null;
  if (m.includes("haiku")) return "haiku";
  if (m.includes("opus")) return "opus";
  if (m.includes("sonnet")) return "sonnet";
  return null;  // glm-*, gpt-*, etc — non-Anthropic, not priced
}

export function eventDollars(ev: CalibrationEvent): number {
  const p = PRICES[ev.family];
  return (
    ev.input * p.input +
    ev.output * p.output +
    ev.cacheRead * p.cacheRead +
    ev.cache_1h * p.cache_1h +
    ev.cache_5m * p.cache_5m
  ) / 1_000_000;
}

// Sum of $ for events in [startMs, endMs). Events MUST be pre-sorted by
// ts so we can break early once past endMs.
export function dollarsInWindow(events: CalibrationEvent[], startMs: number, endMs: number): number {
  let total = 0;
  for (const ev of events) {
    const t = Date.parse(ev.ts);
    if (t < startMs) continue;
    if (t >= endMs) break;
    total += eventDollars(ev);
  }
  return total;
}

export function predictUtilization(
  events: CalibrationEvent[],
  startMs: number,
  endMs: number,
  ratePerPct: number,
): number {
  if (ratePerPct <= 0) return 0;
  return dollarsInWindow(events, startMs, endMs) / ratePerPct;
}

// ──────────────────────────────────────────────────────────────────
//          Snapshot-anchored utilization predictor
// ──────────────────────────────────────────────────────────────────
//
// The predictor builds a curve that passes EXACTLY through every observed
// OAuth snapshot. Between two snapshots in the same cycle, it interpolates
// linearly weighted by JSONL spend. Past the latest snapshot of an
// in-progress cycle (or in any daemon-gap before the first snapshot of a
// cycle) it falls back to a $/pp rate that blends the cycle's own observed
// rate with a robust median of recent prior cycles.
//
// This eliminates rate-modeling error on observed history (residual ~0)
// and only leaves the forward-extrapolation residual past the last poll.

// Minimal structural shape of a daemon snapshot — defined here so this module
// stays free of fs/network deps. Compatible with the richer UsageSnapshot
// types in cli/usage/api.ts and apps/web/lib/usage-data.ts.
export type RateSource = "user_calibrated" | "tier_default";

export type SnapshotForCalibration = {
  captured_at?: string | null;
  five_hour?: { utilization?: number | null; resets_at?: string | null } | null;
  seven_day?: { utilization?: number | null; resets_at?: string | null } | null;
};

export type CycleSnap = { ts: number; pct: number };

const HOUR_MS = 3_600_000;

// Cumulative $-spent indexed by event timestamp, so any (start, end) window
// query is O(log n) via binary search instead of O(n) linear scan. Worth it
// because the curve builder calls this 1000+ times per render.
export type SpendIndex = {
  ts: Float64Array;
  cum: Float64Array;
};

export function buildSpendIndex(events: CalibrationEvent[]): SpendIndex {
  const sorted = events
    .map((e) => ({ e, t: Date.parse(e.ts) }))
    .filter((x) => !Number.isNaN(x.t))
    .sort((a, b) => a.t - b.t);
  const ts = new Float64Array(sorted.length);
  const cum = new Float64Array(sorted.length + 1);
  let acc = 0;
  for (let i = 0; i < sorted.length; i++) {
    ts[i] = sorted[i].t;
    cum[i] = acc;
    acc += eventDollars(sorted[i].e);
  }
  cum[sorted.length] = acc;
  return { ts, cum };
}

function lowerBound(arr: Float64Array, target: number, hi: number): number {
  let lo = 0;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function dollarsInRange(idx: SpendIndex, startMs: number, endMs: number): number {
  if (endMs <= startMs) return 0;
  const n = idx.ts.length;
  const lo = lowerBound(idx.ts, startMs, n);
  const hi = lowerBound(idx.ts, endMs, n);
  return idx.cum[hi]! - idx.cum[lo]!;
}

// Group snapshots by cycle (key = hour-rounded resets_at) for one window.
export function groupSnapsByCycle(
  snapshots: SnapshotForCalibration[],
  pick: (s: SnapshotForCalibration) =>
    | { utilization?: number | null; resets_at?: string | null }
    | null
    | undefined,
): Map<number, CycleSnap[]> {
  const out = new Map<number, CycleSnap[]>();
  for (const s of snapshots) {
    if (!s.captured_at) continue;
    const w = pick(s);
    if (!w?.resets_at || typeof w.utilization !== "number") continue;
    const ts = Date.parse(s.captured_at);
    const reset = Date.parse(w.resets_at);
    if (Number.isNaN(ts) || Number.isNaN(reset)) continue;
    const k = Math.round(reset / HOUR_MS) * HOUR_MS;
    const arr = out.get(k) ?? [];
    arr.push({ ts, pct: w.utilization });
    out.set(k, arr);
  }
  for (const arr of out.values()) arr.sort((a, b) => a.ts - b.ts);
  return out;
}

export type PriorRateInfo = { rate: number; travel: number; dollars: number };

// One observed rate per completed cycle, from full daemon coverage of that
// cycle. Used as the fallback rate prior when the active cycle has thin data.
export function buildPriorRateMap(
  snapsByCycle: Map<number, CycleSnap[]>,
  spend: SpendIndex,
): Map<number, PriorRateInfo> {
  const out = new Map<number, PriorRateInfo>();
  for (const [cycleEnd, arr] of snapsByCycle) {
    if (arr.length < 2) continue;
    const a = arr[0]!;
    const b = arr[arr.length - 1]!;
    const travel = b.pct - a.pct;
    if (travel <= 0) continue;
    const dollars = dollarsInRange(spend, a.ts, b.ts);
    if (dollars <= 0) continue;
    out.set(cycleEnd, { rate: dollars / travel, travel, dollars });
  }
  return out;
}

// Median of the K most recent priors before `cycleEnd`, filtered to those
// with at least `minTravel` pp moved and `minDollars` spent. Median is
// robust against the noisy short cycles (5h cycles have CV ~70% across
// rates; mean is biased by outliers, median sits on the typical day).
function priorMedianRate(
  priors: Map<number, PriorRateInfo>,
  cycleEnd: number,
  k: number,
  minTravel: number,
  minDollars: number,
): number | null {
  const eligible: number[] = [];
  for (const [end, info] of priors) {
    if (end >= cycleEnd) continue;
    if (info.travel < minTravel) continue;
    if (info.dollars < minDollars) continue;
    eligible.push(end);
  }
  eligible.sort((a, b) => b - a);
  const recent = eligible.slice(0, k).map((end) => priors.get(end)!.rate);
  if (recent.length === 0) return null;
  const sorted = [...recent].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  // For even-length arrays, average the two middle values — the conventional
  // median definition. For odd, return the middle element.
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export type AnchoredPredictorOpts = {
  /** Tier-default $/pp rate, used when no observed cycle data is available. */
  tierDefault: number;
  /** Maximum prior cycles to consult for the median fallback. */
  priorK: number;
  /** Minimum pp travel for a prior cycle to count toward the median. */
  priorMinTravel: number;
  /** Minimum $ spent for a prior cycle to count toward the median. */
  priorMinDollars: number;
  /** Travel (pp) at which the active cycle's own rate fully replaces the
   *  prior rate. Below this, the two are blended linearly (with prior
   *  dominating when travel ≈ 0). 30pp is enough for the 1pp-quantized
   *  utilization to carry signal above its rounding noise. */
  travelForFullConfidence: number;
};

const ANCHORED_OPTS_7D: AnchoredPredictorOpts = {
  tierDefault: 12.0,
  priorK: 5,
  priorMinTravel: 10,
  priorMinDollars: 5,
  travelForFullConfidence: 30,
};

const ANCHORED_OPTS_5H: AnchoredPredictorOpts = {
  tierDefault: 2.0,
  priorK: 10,
  priorMinTravel: 20,
  priorMinDollars: 5,
  travelForFullConfidence: 30,
};

export function getAnchoredOpts(window: "5h" | "7d", tier: PlanTier): AnchoredPredictorOpts {
  const base = window === "5h" ? ANCHORED_OPTS_5H : ANCHORED_OPTS_7D;
  const tierDefault = (window === "5h" ? RATE_PER_PCT_5H : RATE_PER_PCT_7D)[tier];
  return { ...base, tierDefault };
}

// The predictor: returns predicted utilization (pp) at time `t`, given the
// cycle's observed snapshots, prior cycle rates, and cycle metadata.
//
// Behavior:
// - between two adjacent snaps a, b in the same cycle:
//     pred(t) = pct_a + (pct_b - pct_a) × ($_a→t / $_a→b)
//   so the curve passes through every observed point exactly.
// - past the latest snap of an in-progress cycle:
//     pred(t) = pct_last + ($_last→t / blendedRate)
// - before the first snap of a cycle (cold-start back-fill):
//     pred(t) = max(0, pct_first - ($_t→first / blendedRate))
// - cycle has no snaps at all: returns the tier-default linear projection
//   from cycle start so cold-start back-fill before any daemon data still
//   draws a curve.
export function predictAnchored(
  spend: SpendIndex,
  cycleSnaps: CycleSnap[],
  priors: Map<number, PriorRateInfo>,
  cycleEndMs: number,
  cycleHours: number,
  t: number,
  opts: AnchoredPredictorOpts,
): number {
  const cycleStart = cycleEndMs - cycleHours * HOUR_MS;

  // Cycle has no observations yet — pure tier-default projection.
  if (cycleSnaps.length === 0) {
    return Math.max(0, dollarsInRange(spend, cycleStart, t) / opts.tierDefault);
  }

  // aIdx = last snap with ts <= t
  let aIdx = -1;
  for (let i = 0; i < cycleSnaps.length; i++) {
    if (cycleSnaps[i]!.ts <= t) aIdx = i;
    else break;
  }

  if (aIdx >= 0 && aIdx + 1 < cycleSnaps.length) {
    // Spend-weighted linear interpolation between adjacent snaps.
    const a = cycleSnaps[aIdx]!;
    const b = cycleSnaps[aIdx + 1]!;
    if (b.pct === a.pct) return a.pct;
    const totalDollars = dollarsInRange(spend, a.ts, b.ts);
    if (totalDollars <= 0) {
      // Daemon recorded a pct change with zero JSONL spend (e.g. non-Anthropic
      // models, or events outside our scan). Fall back to time-linear.
      const frac = (t - a.ts) / (b.ts - a.ts);
      return a.pct + (b.pct - a.pct) * frac;
    }
    const tDollars = dollarsInRange(spend, a.ts, t);
    return a.pct + (b.pct - a.pct) * (tDollars / totalDollars);
  }

  // Forward-extrapolate past last snap, or backward-extrapolate before first.
  const rate = blendedRate(spend, cycleSnaps, priors, cycleEndMs, opts);

  if (aIdx >= 0) {
    const last = cycleSnaps[aIdx]!;
    return last.pct + dollarsInRange(spend, last.ts, t) / rate;
  }
  // t is before every snap of this cycle.
  const first = cycleSnaps[0]!;
  return Math.max(0, first.pct - dollarsInRange(spend, t, first.ts) / rate);
}

function blendedRate(
  spend: SpendIndex,
  cycleSnaps: CycleSnap[],
  priors: Map<number, PriorRateInfo>,
  cycleEndMs: number,
  opts: AnchoredPredictorOpts,
): number {
  // The active cycle's own observed rate, if it has at least 2 snaps with
  // positive travel and spend.
  let curRate: number | null = null;
  let curTravel = 0;
  if (cycleSnaps.length >= 2) {
    const a = cycleSnaps[0]!;
    const b = cycleSnaps[cycleSnaps.length - 1]!;
    const travel = b.pct - a.pct;
    if (travel > 0) {
      const dollars = dollarsInRange(spend, a.ts, b.ts);
      if (dollars > 0) {
        curRate = dollars / travel;
        curTravel = travel;
      }
    }
  }

  const priorRate = priorMedianRate(
    priors,
    cycleEndMs,
    opts.priorK,
    opts.priorMinTravel,
    opts.priorMinDollars,
  );

  if (curRate != null && priorRate != null) {
    const w = Math.min(curTravel / opts.travelForFullConfidence, 1);
    return curRate * w + priorRate * (1 - w);
  }
  return curRate ?? priorRate ?? opts.tierDefault;
}
