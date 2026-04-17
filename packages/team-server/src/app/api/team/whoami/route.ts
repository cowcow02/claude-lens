import { NextRequest, NextResponse } from "next/server";
import { getPool } from "../../../../db/pool";
import { resolveMembershipFromBearer } from "../../../../lib/auth";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }
  const pool = getPool();
  const membership = await resolveMembershipFromBearer(authHeader.slice(7), pool);
  if (!membership) return NextResponse.json({ error: "Invalid or revoked token" }, { status: 401 });

  const res = await pool.query(
    `SELECT t.id AS team_id, t.slug AS team_slug, t.name AS team_name,
            u.email, u.display_name
     FROM memberships m
     JOIN teams t ON t.id = m.team_id
     JOIN user_accounts u ON u.id = m.user_account_id
     WHERE m.id = $1`,
    [membership.id]
  );
  const row = res.rows[0];
  return NextResponse.json({
    membership: { id: membership.id, role: membership.role },
    team: { id: row.team_id, slug: row.team_slug, name: row.team_name },
    user: { email: row.email, displayName: row.display_name },
  });
}
