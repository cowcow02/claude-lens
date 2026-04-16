import { getPool } from "../../../../db/pool.js";
import { cookies } from "next/headers";
import { validateAdminSession } from "../../../../lib/auth.js";
import { SettingsPanel } from "../../../../components/settings-panel.js";

export default async function SettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const pool = getPool();

  const cookieStore = await cookies();
  const cookieToken = cookieStore.get("fleetlens_session")?.value;
  if (!cookieToken) return <div>Unauthorized.</div>;

  const session = await validateAdminSession(cookieToken, pool);
  if (!session) return <div>Session expired.</div>;

  const memberRes = await pool.query("SELECT team_id, role FROM members WHERE id = $1", [session.memberId]);
  if (memberRes.rows[0]?.role !== "admin") return <div>Admin access required.</div>;

  const teamRes = await pool.query(
    "SELECT id, name, slug, retention_days, custom_domain, created_at FROM teams WHERE id = $1",
    [memberRes.rows[0].team_id]
  );
  const team = teamRes.rows[0];

  // Get members list
  const members = await pool.query(
    "SELECT id, email, display_name, role, joined_at, last_seen_at, revoked_at FROM members WHERE team_id = $1 ORDER BY joined_at",
    [team.id]
  );

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 24 }}>Settings</h1>
      <SettingsPanel team={team} members={members.rows} teamSlug={slug} />
    </div>
  );
}
