import {
  nextTierDown,
  nextTierUp,
  type PlanTierEntry,
  type PlanTierKey,
} from "./plan-tiers";

// Aggregated stats over the last 30 days for one member, derived from
// membership_weekly_utilization. All percentages are 0-100. nulls represent
// "no observation yet" — distinct from 0% utilization.
export type MemberStats = {
  worstSevenDayPeak: number; // max(seven_day_utilization) across the window
  avgSevenDayAvg: number;    // average of per-week avg(seven_day_utilization)
  worstFiveHourPeak: number; // max(five_hour_utilization)
  worstOpusPeak: number;     // max(seven_day_opus_utilization)
  totalDaysObserved: number; // distinct days the daemon ran
  lastSeenAtMs: number | null;
};

export type OptimizerSettings = {
  minDaysRequired: number;        // default 14
  upgradeIfAvgAbove: number;      // default 80
  urgentUpgradeIfMaxAbove: number; // default 95
  downgradeIfAvgBelow: number;    // default 40
  downgradeIfMaxBelow: number;    // default 60
};

export const DEFAULT_OPTIMIZER_SETTINGS: OptimizerSettings = {
  minDaysRequired: 14,
  upgradeIfAvgAbove: 80,
  urgentUpgradeIfMaxAbove: 95,
  downgradeIfAvgBelow: 40,
  downgradeIfMaxBelow: 60,
};

export type Confidence = "high" | "medium" | "low" | "insufficient";

export type Recommendation =
  | { action: "insufficient_data"; confidence: "insufficient"; rationale: string }
  | { action: "review_manually"; confidence: "insufficient"; rationale: string }
  | { action: "top_up_needed"; confidence: Confidence; rationale: string }
  | {
      action: "upgrade_urgent";
      confidence: Confidence;
      targetTier: PlanTierKey;
      rationale: string;
    }
  | {
      action: "upgrade";
      confidence: Confidence;
      targetTier: PlanTierKey;
      rationale: string;
    }
  | {
      action: "downgrade";
      confidence: Confidence;
      targetTier: PlanTierKey;
      estimatedSavingsUsd: number;
      rationale: string;
    }
  | { action: "stay"; confidence: Confidence; rationale: string };

export function recommend(
  m: MemberStats,
  tier: PlanTierEntry,
  settings: OptimizerSettings = DEFAULT_OPTIMIZER_SETTINGS,
): Recommendation {
  if (m.totalDaysObserved < settings.minDaysRequired) {
    return {
      action: "insufficient_data",
      confidence: "insufficient",
      rationale: `Only ${m.totalDaysObserved} days observed in the last 30. Need at least ${settings.minDaysRequired} for a recommendation.`,
    };
  }

  // Custom tier: optimizer can compute percentages but not dollar deltas, so
  // it never proposes an automated move. Admin reviews manually.
  if (tier.rank < 0) {
    return {
      action: "review_manually",
      confidence: "insufficient",
      rationale: `On Custom tier — usage is ${m.avgSevenDayAvg.toFixed(0)}% avg / ${m.worstSevenDayPeak.toFixed(0)}% peak, but Fleetlens does not know the dollar cap.`,
    };
  }

  const conf = pickConfidence(m, settings);

  if (m.worstSevenDayPeak >= 100) {
    return {
      action: "top_up_needed",
      confidence: conf,
      rationale: `Hit ${m.worstSevenDayPeak.toFixed(0)}% of 7-day cap at least once in the last 30 days. Throttling risk.`,
    };
  }

  if (tier.rank <= 1 && m.worstSevenDayPeak >= settings.urgentUpgradeIfMaxAbove) {
    const target = nextTierUp(tier.key);
    if (target) {
      return {
        action: "upgrade_urgent",
        confidence: conf,
        targetTier: target.key,
        rationale: `Peaked at ${m.worstSevenDayPeak.toFixed(0)}% on ${tier.label}. Upgrade to ${target.label} to avoid throttling.`,
      };
    }
  }

  if (m.avgSevenDayAvg >= settings.upgradeIfAvgAbove) {
    const target = nextTierUp(tier.key);
    if (target) {
      return {
        action: "upgrade",
        confidence: conf,
        targetTier: target.key,
        rationale: `Averaging ${m.avgSevenDayAvg.toFixed(0)}% of ${tier.label}. Upgrade to ${target.label} for headroom.`,
      };
    }
  }

  if (
    tier.rank >= 2 &&
    m.avgSevenDayAvg < settings.downgradeIfAvgBelow &&
    m.worstSevenDayPeak < settings.downgradeIfMaxBelow
  ) {
    const target = nextTierDown(tier.key);
    if (target) {
      const headroomPct = Math.round((1 - m.worstSevenDayPeak / 100) * 100);
      return {
        action: "downgrade",
        confidence: conf,
        targetTier: target.key,
        // Anthropic bills these tiers monthly, so the saving is just the
        // monthly subscription delta — e.g., $200/mo → $100/mo saves $100/mo,
        // not $100 × 4.33 weeks.
        estimatedSavingsUsd: tier.monthlyPriceUsd - target.monthlyPriceUsd,
        rationale: `Averaging ${m.avgSevenDayAvg.toFixed(0)}% with peak ${m.worstSevenDayPeak.toFixed(0)}% on ${tier.label}. Downgrading to ${target.label} retains ${headroomPct}% headroom.`,
      };
    }
  }

  return {
    action: "stay",
    confidence: conf,
    rationale: `Plan well-matched to usage: avg ${m.avgSevenDayAvg.toFixed(0)}%, peak ${m.worstSevenDayPeak.toFixed(0)}%.`,
  };
}

const NEAR_THRESHOLD_MARGIN = 10;

function pickConfidence(m: MemberStats, s: OptimizerSettings): Confidence {
  if (m.totalDaysObserved >= 21 && !nearAnyThreshold(m, s)) return "high";
  if (nearAnyThreshold(m, s)) return "low";
  return "medium";
}

function nearAnyThreshold(m: MemberStats, s: OptimizerSettings): boolean {
  const margins = [
    Math.abs(m.avgSevenDayAvg - s.upgradeIfAvgAbove),
    Math.abs(m.worstSevenDayPeak - s.urgentUpgradeIfMaxAbove),
    Math.abs(m.avgSevenDayAvg - s.downgradeIfAvgBelow),
    Math.abs(m.worstSevenDayPeak - s.downgradeIfMaxBelow),
  ];
  return margins.some((d) => d < NEAR_THRESHOLD_MARGIN);
}
