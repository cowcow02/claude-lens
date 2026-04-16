import { NextRequest, NextResponse } from "next/server";
import { getPool } from "../../../../../db/pool.js";
import { validateAdminSession } from "../../../../../lib/auth.js";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const cookieToken = req.cookies.get("fleetlens_session")?.value;
  if (!cookieToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const pool = getPool();
  const session = await validateAdminSession(cookieToken, pool);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Get member
  const memberRes = await pool.query(
    "SELECT id, team_id, email, display_name, role, joined_at, last_seen_at FROM members WHERE id = $1",
    [id]
  );
  if (!memberRes.rowCount) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const member = memberRes.rows[0];

  // 30 days of rollups
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const rollups = await pool.query(`
    SELECT day, agent_time_ms, sessions, tool_calls, turns,
           tokens_input, tokens_output, tokens_cache_read, tokens_cache_write
    FROM daily_rollups
    WHERE team_id = $1 AND member_id = $2 AND day >= $3
    ORDER BY day ASC
  `, [member.team_id, id, thirtyDaysAgo]);

  return NextResponse.json({ member, rollups: rollups.rows });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const cookieToken = req.cookies.get("fleetlens_session")?.value;
  if (!cookieToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const pool = getPool();
  const session = await validateAdminSession(cookieToken, pool);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Check admin role
  const adminCheck = await pool.query("SELECT role FROM members WHERE id = $1", [session.memberId]);
  if (adminCheck.rows[0]?.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  await pool.query("UPDATE members SET revoked_at = now() WHERE id = $1", [id]);
  return NextResponse.json({ revoked: true });
}
