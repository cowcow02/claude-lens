import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, requireTeamMembership } from "../../../../lib/route-helpers";
import {
  loadOptimizerInputs,
  loadOptimizerSettings,
} from "../../../../lib/plan-queries";
import { recommend, type Recommendation } from "../../../../lib/plan-optimizer";
import { tierEntry } from "../../../../lib/plan-tiers";

type ResponseRow = {
  membershipId: string;
  memberName: string;
  memberEmail: string | null;
  currentPlan: { key: string; label: string; monthlyPriceUsd: number };
  usage: {
    avgSevenDayPct: number;
    worstSevenDayPeak: number;
    worstFiveHourPeak: number;
    worstOpusPeak: number;
    totalDaysObserved: number;
    lastSeen: string | null;
  };
  recommendation: Recommendation;
};

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("team");
  if (!slug) return NextResponse.json({ error: "team slug required" }, { status: 400 });

  const ctx = await requireTeamMembership(req, slug, { bySlug: true });
  if (ctx instanceof NextResponse) return ctx;

  const adminGate = requireAdmin(ctx);
  if (adminGate) return adminGate;

  const [inputs, settings] = await Promise.all([
    loadOptimizerInputs(ctx.membership.team_id, ctx.pool),
    loadOptimizerSettings(ctx.membership.team_id, ctx.pool),
  ]);

  const recommendations: ResponseRow[] = inputs.map((input) => {
    const tier = tierEntry(input.tierKey);
    const r = recommend(input.stats, tier, settings);
    return {
      membershipId: input.membershipId,
      memberName: input.memberName,
      memberEmail: input.memberEmail,
      currentPlan: {
        key: tier.key,
        label: tier.label,
        monthlyPriceUsd: tier.monthlyPriceUsd,
      },
      usage: {
        avgSevenDayPct: input.stats.avgSevenDayAvg,
        worstSevenDayPeak: input.stats.worstSevenDayPeak,
        worstFiveHourPeak: input.stats.worstFiveHourPeak,
        worstOpusPeak: input.stats.worstOpusPeak,
        totalDaysObserved: input.stats.totalDaysObserved,
        lastSeen:
          input.stats.lastSeenAtMs != null
            ? new Date(input.stats.lastSeenAtMs).toISOString()
            : null,
      },
      recommendation: r,
    };
  });

  let monthlyDelta = 0;
  let toUpgrade = 0;
  let toDowngrade = 0;
  let custom = 0;
  let insufficient = 0;
  for (const row of recommendations) {
    switch (row.recommendation.action) {
      case "upgrade":
      case "upgrade_urgent":
        toUpgrade++;
        break;
      case "downgrade":
        toDowngrade++;
        monthlyDelta -= row.recommendation.estimatedSavingsUsd;
        break;
      case "review_manually":
        custom++;
        break;
      case "insufficient_data":
        insufficient++;
        break;
    }
  }

  return NextResponse.json({
    recommendations,
    summary: {
      membersToUpgrade: toUpgrade,
      membersToDowngrade: toDowngrade,
      membersCustomTier: custom,
      membersInsufficientData: insufficient,
      estimatedMonthlyDelta: monthlyDelta,
    },
    settings,
  });
}
