import { NextRequest, NextResponse } from "next/server";
import { getPool } from "../../../../db/pool";
import { redeemInvite } from "../../../../lib/members";
import { authenticate } from "../../../../lib/auth";
import { rateLimit, clientKey } from "../../../../lib/rate-limit";

export async function POST(req: NextRequest) {
  const rl = rateLimit(`join:${clientKey(req)}`, 20, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const inviteToken = typeof body?.inviteToken === "string" ? body.inviteToken : "";
  const email = typeof body?.email === "string" ? body.email : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!inviteToken || !email || !password) {
    return NextResponse.json({ error: "inviteToken, email, password required" }, { status: 400 });
  }

  const pool = getPool();
  const user = await authenticate(email, password, pool);
  if (!user) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const redeemed = await redeemInvite(inviteToken, user.id, pool);
  if (!redeemed) {
    return NextResponse.json({ error: "Invite is invalid or expired" }, { status: 400 });
  }

  const slugRes = await pool.query("SELECT slug FROM teams WHERE id = $1", [redeemed.teamId]);
  const host = req.headers.get("host") || "";
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const serverBaseUrl = process.env.BASE_URL || `${proto}://${host}`;

  return NextResponse.json({
    member: { id: redeemed.membershipId, email: user.email, displayName: user.display_name, role: "member" },
    bearerToken: redeemed.bearerToken,
    teamSlug: slugRes.rows[0]?.slug,
    serverBaseUrl,
  }, { status: 201 });
}
