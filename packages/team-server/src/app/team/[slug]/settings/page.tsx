import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPool } from "../../../../db/pool";
import { validateSession } from "../../../../lib/auth";
import { SettingsPanel } from "../../../../components/settings-panel";

export default async function SettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const pool = getPool();

  const cookieStore = await cookies();
  const token = cookieStore.get("fleetlens_session")?.value;
  const session = token ? await validateSession(token, pool) : null;
  if (!session) redirect("/login");

  const teamRes = await pool.query(
    "SELECT id, name, slug, retention_days, custom_domain, created_at FROM teams WHERE slug = $1",
    [slug],
  );
  if (!teamRes.rowCount) return <div>Team not found.</div>;
  const team = teamRes.rows[0];

  const m = session.memberships.find((x) => x.team_id === team.id);
  if (!m) redirect("/login");
  if (m.role !== "admin") {
    return (
      <div className="section-head">
        <div>
          <h1>Admin <em>only</em></h1>
          <div className="kicker" style={{ marginTop: 8 }}>Settings are visible to admins only.</div>
        </div>
      </div>
    );
  }

  const members = await pool.query(
    `SELECT m.id, u.email, u.display_name, m.role, m.joined_at, m.last_seen_at, m.revoked_at
     FROM memberships m JOIN user_accounts u ON u.id = m.user_account_id
     WHERE m.team_id = $1 ORDER BY m.joined_at`,
    [team.id]
  );

  return (
    <>
      <div className="section-head">
        <div>
          <h1><em>Settings</em></h1>
          <div className="kicker" style={{ marginTop: 8 }}>
            Team configuration · {members.rows.filter((mm) => !mm.revoked_at).length} active members
          </div>
        </div>
      </div>
      <SettingsPanel team={team} members={members.rows} teamSlug={slug} />
    </>
  );
}
