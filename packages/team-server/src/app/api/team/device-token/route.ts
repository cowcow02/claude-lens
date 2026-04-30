import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getPool } from "../../../../db/pool";
import { validateSession } from "../../../../lib/auth";
import { generateToken, sha256 } from "../../../../lib/crypto";
import { rateLimit, clientKey } from "../../../../lib/rate-limit";

// POST /api/team/device-token — mint a fresh CLI device token for the
// authenticated user's membership on a given team. Returns the plaintext
// bearer token in the body (it's hashed in DB; admin doesn't need to
// know it). Old token is revoked by overwriting the hash, so any
// previously-paired daemon will start failing /api/ingest auth.
//
// Body: { teamSlug: string }
//
// This is the self-service version of the pairing flow — bypasses the
// invite-and-redeem dance for users who already have a session and
// just want to (re)pair a device.
export async function POST(req: NextRequest) {
  const rl = rateLimit(`device-token:${clientKey(req)}`, 10, 60_000);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const pool = getPool();
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get("fleetlens_session")?.value;
  const session = sessionToken ? await validateSession(sessionToken, pool) : null;
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const teamSlug = typeof body?.teamSlug === "string" ? body.teamSlug : "";
  if (!teamSlug) return NextResponse.json({ error: "teamSlug required" }, { status: 400 });

  const teamRes = await pool.query<{ id: string }>(
    "SELECT id FROM teams WHERE slug = $1",
    [teamSlug],
  );
  if (teamRes.rowCount === 0) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }
  const teamId = teamRes.rows[0]!.id;

  const membership = session.memberships.find((m) => m.team_id === teamId);
  if (!membership) {
    return NextResponse.json({ error: "Not a member of this team" }, { status: 403 });
  }

  // Mint a new bearer token, hash it, and overwrite the existing hash
  // on this membership row. Any device using the previous token now
  // fails 401 on its next push.
  const bearerToken = "bt_" + generateToken(32);
  const bearerTokenHash = sha256(bearerToken);
  await pool.query(
    "UPDATE memberships SET bearer_token_hash = $1 WHERE id = $2",
    [bearerTokenHash, membership.id],
  );

  // Build the server URL the daemon should use, mirroring the join API.
  const host = req.headers.get("host") || "";
  const proto = req.headers.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const serverUrl = process.env.BASE_URL || `${proto}://${host}`;

  return NextResponse.json({ bearerToken, serverUrl }, { status: 201 });
}
