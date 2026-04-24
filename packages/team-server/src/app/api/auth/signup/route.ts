import { NextRequest, NextResponse } from "next/server";
import { getPool } from "../../../../db/pool";
import { createFirstOrSubsequentUser, createSession } from "../../../../lib/auth";
import { createTeamWithAdmin } from "../../../../lib/teams";
import { lookupInvite, redeemInvite } from "../../../../lib/members";
import { instanceState, setConfig } from "../../../../lib/server-config";
import { rateLimit, clientKey } from "../../../../lib/rate-limit";

type SignupBody = {
  email?: unknown;
  password?: unknown;
  displayName?: unknown;
  teamName?: unknown;
  inviteToken?: unknown;
};

function isEmail(s: unknown): s is string {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export async function POST(req: NextRequest) {
  const rl = rateLimit(`signup:${clientKey(req)}`, 10, 60_000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.retryAfterMs ?? 60000) / 1000)) } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as SignupBody;
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const displayName = typeof body.displayName === "string" && body.displayName.trim() ? body.displayName.trim() : null;
  const teamName = typeof body.teamName === "string" ? body.teamName.trim() : "";
  const inviteToken = typeof body.inviteToken === "string" ? body.inviteToken.trim() : "";

  if (!isEmail(email)) return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });

  const pool = getPool();
  const state = await instanceState(pool);

  const isFirstUser = !state.hasAnyUser;
  const hasInvite = !!inviteToken;
  const publicSignupOK = state.allowPublicSignup && state.hasAnyUser;

  if (!isFirstUser && !hasInvite && !publicSignupOK) {
    return NextResponse.json(
      { error: "Signup is closed. Ask an admin for an invite link." },
      { status: 403 },
    );
  }

  let invite: Awaited<ReturnType<typeof lookupInvite>> = null;
  if (hasInvite) {
    invite = await lookupInvite(inviteToken, pool);
    if (!invite) return NextResponse.json({ error: "Invite is invalid or expired" }, { status: 400 });
    if (invite.email && invite.email !== email.toLowerCase()) {
      return NextResponse.json({ error: "Invite is scoped to a different email" }, { status: 400 });
    }
  }

  if (isFirstUser && !teamName) {
    return NextResponse.json({ error: "First signup must name the team" }, { status: 400 });
  }

  let user;
  let promotedToStaff = false;
  try {
    const created = await createFirstOrSubsequentUser(email, password, displayName, pool);
    user = created.user;
    promotedToStaff = created.promotedToStaff;
  } catch (err) {
    if (err instanceof Error && /unique|duplicate/i.test(err.message)) {
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
    }
    throw err;
  }

  // The authoritative "first user" signal is whether we just promoted this account
  // to staff inside the atomic transaction. `isFirstUser` above (from instanceState)
  // is a pre-transaction hint used only for gating + teamName validation.
  const didBootstrap = promotedToStaff;

  let landingSlug: string | null = null;
  let deviceToken: string | null = null;

  if (didBootstrap) {
    const { team, membership } = await createTeamWithAdmin(teamName, user.id, pool);
    landingSlug = team.slug;
    deviceToken = membership.bearerToken;
    await setConfig("allow_public_signup", "false", pool);
    await setConfig("allow_multiple_teams", "false", pool);
    await pool.query(
      "INSERT INTO events (actor_id, action, payload) VALUES ($1, 'instance.bootstrap', $2)",
      [user.id, JSON.stringify({ teamId: team.id, teamName: team.name })]
    );
  } else if (invite) {
    const redeemed = await redeemInvite(inviteToken, user.id, pool);
    if (!redeemed) return NextResponse.json({ error: "Invite could not be redeemed" }, { status: 400 });
    const slugRes = await pool.query("SELECT slug FROM teams WHERE id = $1", [redeemed.teamId]);
    landingSlug = slugRes.rows[0]?.slug ?? null;
    deviceToken = redeemed.bearerToken;
  }

  const { cookieToken } = await createSession(user.id, pool);
  const res = NextResponse.json(
    {
      user: { id: user.id, email: user.email, displayName: user.display_name },
      landingSlug,
      isFirstUser,
      deviceToken,
    },
    { status: 201 },
  );
  res.cookies.set("fleetlens_session", cookieToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 365 * 24 * 60 * 60,
  });
  return res;
}
