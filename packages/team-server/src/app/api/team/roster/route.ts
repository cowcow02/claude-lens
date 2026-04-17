import { NextRequest, NextResponse } from "next/server";
import { requireTeamMembership } from "../../../../lib/route-helpers";
import { loadRoster } from "../../../../lib/queries";

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("team");
  if (!slug) return NextResponse.json({ error: "team slug required" }, { status: 400 });

  const ctx = await requireTeamMembership(req, slug, { bySlug: true });
  if (ctx instanceof NextResponse) return ctx;

  return NextResponse.json(await loadRoster(ctx.membership.team_id, ctx.pool));
}
