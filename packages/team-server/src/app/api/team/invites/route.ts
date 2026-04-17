import { NextRequest, NextResponse } from "next/server";
import { requireTeamMembership, requireAdmin } from "../../../../lib/route-helpers";
import { createInvite } from "../../../../lib/members";

export async function POST(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("team");
  if (!slug) return NextResponse.json({ error: "team slug required" }, { status: 400 });

  const ctx = await requireTeamMembership(req, slug, { bySlug: true });
  if (ctx instanceof NextResponse) return ctx;
  const adminErr = requireAdmin(ctx);
  if (adminErr) return adminErr;

  const body = await req.json().catch(() => ({}));
  const result = await createInvite(
    ctx.membership.team_id,
    ctx.user.id,
    {
      email: typeof body?.email === "string" ? body.email : undefined,
      role: body?.role === "admin" ? "admin" : "member",
      expiresInDays: typeof body?.expiresInDays === "number" ? body.expiresInDays : 7,
    },
    ctx.pool,
  );

  const host = req.headers.get("host") || "";
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const serverBaseUrl = process.env.BASE_URL || `${proto}://${host}`;
  return NextResponse.json({
    inviteId: result.inviteId,
    joinUrl: `${serverBaseUrl}/signup?invite=${result.token}`,
    tokenPlaintext: result.token,
    expiresAt: result.expiresAt,
  }, { status: 201 });
}
