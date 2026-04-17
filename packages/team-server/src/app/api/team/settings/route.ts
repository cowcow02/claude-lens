import { NextRequest, NextResponse } from "next/server";
import { requireTeamMembership, requireAdmin } from "../../../../lib/route-helpers";

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("team");
  if (!slug) return NextResponse.json({ error: "team slug required" }, { status: 400 });

  const ctx = await requireTeamMembership(req, slug, { bySlug: true });
  if (ctx instanceof NextResponse) return ctx;
  const adminErr = requireAdmin(ctx);
  if (adminErr) return adminErr;

  const res = await ctx.pool.query(
    "SELECT name, slug, retention_days, custom_domain, settings, created_at FROM teams WHERE id = $1",
    [ctx.membership.team_id]
  );
  return NextResponse.json(res.rows[0]);
}

export async function PUT(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("team");
  if (!slug) return NextResponse.json({ error: "team slug required" }, { status: 400 });

  const ctx = await requireTeamMembership(req, slug, { bySlug: true });
  if (ctx instanceof NextResponse) return ctx;
  const adminErr = requireAdmin(ctx);
  if (adminErr) return adminErr;

  const body = await req.json();
  if (body.name) {
    await ctx.pool.query("UPDATE teams SET name = $1 WHERE id = $2", [body.name, ctx.membership.team_id]);
  }
  if (body.retentionDays) {
    await ctx.pool.query("UPDATE teams SET retention_days = $1 WHERE id = $2", [body.retentionDays, ctx.membership.team_id]);
  }
  return NextResponse.json({ updated: true });
}
