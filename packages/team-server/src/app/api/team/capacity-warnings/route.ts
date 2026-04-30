import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, requireTeamMembership } from "../../../../lib/route-helpers";
import { loadLatestSnapshotsPerMember } from "../../../../lib/plan-queries";
import { computeBurndown } from "../../../../lib/capacity-burndown";

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("team");
  if (!slug) return NextResponse.json({ error: "team slug required" }, { status: 400 });

  const ctx = await requireTeamMembership(req, slug, { bySlug: true });
  if (ctx instanceof NextResponse) return ctx;

  const adminGate = requireAdmin(ctx);
  if (adminGate) return adminGate;

  const snapshots = await loadLatestSnapshotsPerMember(ctx.membership.team_id, ctx.pool);
  const burndown = computeBurndown(snapshots);

  return NextResponse.json({ burndown });
}
