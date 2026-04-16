import { getPool } from "../../../../../db/pool.js";
import { cookies } from "next/headers";
import { validateAdminSession } from "../../../../../lib/auth.js";
import { MemberProfile } from "../../../../../components/member-profile.js";

export default async function MemberPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const pool = getPool();

  const cookieStore = await cookies();
  const cookieToken = cookieStore.get("fleetlens_session")?.value;
  if (!cookieToken) return <div>Unauthorized.</div>;

  const session = await validateAdminSession(cookieToken, pool);
  if (!session) return <div>Session expired.</div>;

  const memberRes = await pool.query(
    "SELECT id, team_id, email, display_name, role, joined_at, last_seen_at FROM members WHERE id = $1",
    [id]
  );
  if (!memberRes.rowCount) return <div>Member not found.</div>;
  const member = memberRes.rows[0];

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const rollups = await pool.query(`
    SELECT day::text, agent_time_ms::int, sessions, tool_calls, turns,
           tokens_input::int, tokens_output::int, tokens_cache_read::int, tokens_cache_write::int
    FROM daily_rollups
    WHERE team_id = $1 AND member_id = $2 AND day >= $3
    ORDER BY day ASC
  `, [member.team_id, id, thirtyDaysAgo]);

  return (
    <div>
      <a href={`/team/${slug}`} style={{ color: "#6b7280", fontSize: 14, textDecoration: "none" }}>
        ← Back to Roster
      </a>
      <MemberProfile member={member} rollups={rollups.rows} teamSlug={slug} />
    </div>
  );
}
