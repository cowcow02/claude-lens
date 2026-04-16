import { getPool } from "../../../db/pool.js";
import { cookies } from "next/headers";
import { validateAdminSession } from "../../../lib/auth.js";
import { RosterCard } from "../../../components/roster-card.js";
import { LiveRefresher } from "../../../components/live-refresher.js";

export default async function RosterPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const pool = getPool();

  const cookieStore = await cookies();
  const cookieToken = cookieStore.get("fleetlens_session")?.value;
  if (!cookieToken) return <div>Unauthorized. Please claim or log in.</div>;

  const session = await validateAdminSession(cookieToken, pool);
  if (!session) return <div>Session expired. Please log in again.</div>;

  const teamRes = await pool.query("SELECT id, name FROM teams WHERE slug = $1", [slug]);
  if (!teamRes.rowCount) return <div>Team not found.</div>;
  const teamId = teamRes.rows[0].id;

  const now = new Date();
  const dayOfWeek = now.getDay();
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset);
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

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Team Roster</h1>
        <span style={{ color: "#6b7280" }}>{roster.rowCount} members</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
        {roster.rows.map((m: any) => <RosterCard key={m.id} member={m} teamSlug={slug} />)}
      </div>
      <LiveRefresher />
    </div>
  );
}
