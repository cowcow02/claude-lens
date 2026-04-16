import { NextRequest, NextResponse } from "next/server";
import { getPool } from "../../../../db/pool.js";
import { validateAdminSession } from "../../../../lib/auth.js";

export async function GET(req: NextRequest) {
  const cookieToken = req.cookies.get("fleetlens_session")?.value;
  if (!cookieToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const pool = getPool();
  const session = await validateAdminSession(cookieToken, pool);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const memberRes = await pool.query("SELECT team_id FROM members WHERE id = $1", [session.memberId]);
  if (!memberRes.rowCount) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const teamId = memberRes.rows[0].team_id;

  const now = new Date();
  const dayOfWeek = now.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset);
  monday.setHours(0, 0, 0, 0);
  const mondayStr = monday.toISOString().slice(0, 10);

  const roster = await pool.query(`
    SELECT
      m.id, m.email, m.display_name, m.role, m.joined_at, m.last_seen_at,
      COALESCE(SUM(r.agent_time_ms), 0)::bigint AS week_agent_time_ms,
      COALESCE(SUM(r.sessions), 0)::int AS week_sessions,
      COALESCE(SUM(r.tool_calls), 0)::int AS week_tool_calls,
      COALESCE(SUM(r.turns), 0)::int AS week_turns,
      COALESCE(SUM(r.tokens_input + r.tokens_output), 0)::bigint AS week_tokens
    FROM members m
    LEFT JOIN daily_rollups r ON r.member_id = m.id AND r.team_id = m.team_id AND r.day >= $2
    WHERE m.team_id = $1 AND m.revoked_at IS NULL
    GROUP BY m.id
    ORDER BY m.last_seen_at DESC NULLS LAST
  `, [teamId, mondayStr]);

  return NextResponse.json(roster.rows);
}
