import { tierEntry, type PlanTierKey } from "./plan-tiers";

// One member's most recent snapshot, joined with their plan tier. Members on
// `custom` tier are excluded by the caller (no dollar cap to compare against).
export type MemberLatestSnapshot = {
  membershipId: string;
  memberName: string;
  tierKey: PlanTierKey;
  sevenDayUtilization: number | null; // 0-100
  sevenDayResetsAt: Date | null;
  capturedAt: Date;
};

export type BurndownLevel = "red" | "yellow" | "info";

export type BurndownContributor = {
  memberName: string;
  contributionUsd: number;
  tierLabel: string;
};

export type BurndownResult = {
  level: BurndownLevel;
  message: string | null;
  currentSpendUsd: number;
  capUsd: number;
  projectedEndOfWindowUsd: number | null;
  avgWindowFractionElapsed: number;
  approxDaysRemaining: number | null;
  topContributors: BurndownContributor[];
};

const SECONDS_PER_DAY = 86_400;
const WINDOW_LENGTH_SECONDS = 7 * SECONDS_PER_DAY;
const TOP_CONTRIBUTORS = 3;

// Skip projection when too little of the window has elapsed — projection
// blows up to absurd values (current * 100 when only 1% in).
const MIN_WINDOW_FRACTION_FOR_PROJECTION = 0.1;

const RED_PROJECTION_PCT = 100;
const YELLOW_PROJECTION_PCT_LO = 85;
const RED_MAX_FRACTION = 0.8;
const YELLOW_MAX_FRACTION = 0.7;

export function computeBurndown(
  members: MemberLatestSnapshot[],
  nowMs: number = Date.now(),
): BurndownResult {
  const priced = members.filter((m) => {
    const t = tierEntry(m.tierKey);
    return t.monthlyPriceUsd > 0; // excludes custom tier
  });

  if (priced.length === 0) {
    return zero("info");
  }

  let currentSpendUsd = 0;
  let capUsd = 0;
  let fractionSum = 0;
  let fractionCount = 0;
  const contributions: BurndownContributor[] = [];

  for (const m of priced) {
    const t = tierEntry(m.tierKey);
    capUsd += t.monthlyPriceUsd;

    const util = m.sevenDayUtilization;
    const contributionUsd = util != null ? (util / 100) * t.monthlyPriceUsd : 0;
    currentSpendUsd += contributionUsd;
    contributions.push({
      memberName: m.memberName,
      contributionUsd,
      tierLabel: t.label,
    });

    if (m.sevenDayResetsAt) {
      const elapsedSec =
        (nowMs - (m.sevenDayResetsAt.getTime() - WINDOW_LENGTH_SECONDS * 1000)) /
        1000;
      const frac = clamp(elapsedSec / WINDOW_LENGTH_SECONDS, 0, 1);
      fractionSum += frac;
      fractionCount++;
    }
  }

  const avgFraction = fractionCount > 0 ? fractionSum / fractionCount : 0;

  let projectedEndOfWindowUsd: number | null = null;
  if (avgFraction >= MIN_WINDOW_FRACTION_FOR_PROJECTION) {
    projectedEndOfWindowUsd = currentSpendUsd / avgFraction;
  }

  const projectionPct =
    projectedEndOfWindowUsd != null && capUsd > 0
      ? (projectedEndOfWindowUsd / capUsd) * 100
      : 0;

  let level: BurndownLevel = "info";
  let message: string | null = null;
  if (
    projectedEndOfWindowUsd != null &&
    projectionPct > RED_PROJECTION_PCT &&
    avgFraction < RED_MAX_FRACTION
  ) {
    level = "red";
    message = `Team on track to exceed 7-day cap (projected ${Math.round(projectionPct)}% of $${capUsd}).`;
  } else if (
    projectedEndOfWindowUsd != null &&
    projectionPct >= YELLOW_PROJECTION_PCT_LO &&
    projectionPct <= RED_PROJECTION_PCT &&
    avgFraction < YELLOW_MAX_FRACTION
  ) {
    level = "yellow";
    message = `Team on track to hit ${Math.round(projectionPct)}% of 7-day cap before current windows close.`;
  }

  contributions.sort((a, b) => b.contributionUsd - a.contributionUsd);

  const approxDaysRemaining =
    avgFraction > 0 ? clamp((1 - avgFraction) * 7, 0, 7) : null;

  return {
    level,
    message,
    currentSpendUsd,
    capUsd,
    projectedEndOfWindowUsd,
    avgWindowFractionElapsed: avgFraction,
    approxDaysRemaining,
    topContributors: contributions.slice(0, TOP_CONTRIBUTORS),
  };
}

function zero(level: BurndownLevel): BurndownResult {
  return {
    level,
    message: null,
    currentSpendUsd: 0,
    capUsd: 0,
    projectedEndOfWindowUsd: null,
    avgWindowFractionElapsed: 0,
    approxDaysRemaining: null,
    topContributors: [],
  };
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
