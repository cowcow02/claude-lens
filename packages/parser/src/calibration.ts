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
