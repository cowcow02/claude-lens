import { NextRequest, NextResponse } from "next/server";
import { getPool } from "../../../../db/pool";
import { authenticate, createSession } from "../../../../lib/auth";
import { rateLimit, clientKey } from "../../../../lib/rate-limit";

export async function POST(req: NextRequest) {
  const rl = rateLimit(`login:${clientKey(req)}`, 10, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.retryAfterMs ?? 60000) / 1000)) } },
    );
  }

  const body = await req.json().catch(() => ({}));
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  }

  const pool = getPool();
  const user = await authenticate(email, password, pool);
  if (!user) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const membership = await pool.query<{ team_slug: string }>(
    `SELECT t.slug AS team_slug FROM memberships m
     JOIN teams t ON t.id = m.team_id
     WHERE m.user_account_id = $1 AND m.revoked_at IS NULL
     ORDER BY m.joined_at LIMIT 1`,
    [user.id]
  );

  const { cookieToken } = await createSession(user.id, pool);
  const res = NextResponse.json({
    user: { id: user.id, email: user.email, displayName: user.display_name },
    landingSlug: membership.rows[0]?.team_slug ?? null,
  });
  res.cookies.set("fleetlens_session", cookieToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 365 * 24 * 60 * 60,
  });
  return res;
}
