import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPool } from "../../../../db/pool";
import { validateSession } from "../../../../lib/auth";
import { PairCliPanel } from "../../../../components/pair-cli-panel";

// Per-user personal settings within a team. First (and currently only)
// feature is CLI pairing — visible to every signed-in member regardless
// of role, since each user pairs their own seat. /team/<slug>/settings
// stays admin-only for team-wide configuration; this page is the user's
// own seat-level controls.
export default async function MeSettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const pool = getPool();

  const cookieStore = await cookies();
  const token = cookieStore.get("fleetlens_session")?.value;
  const session = token ? await validateSession(token, pool) : null;
  if (!session) redirect("/login");

  const teamRes = await pool.query<{ id: string; name: string }>(
    "SELECT id, name FROM teams WHERE slug = $1",
    [slug],
  );
  if (!teamRes.rowCount) redirect("/login");
  const team = teamRes.rows[0]!;

  const myMembership = session.memberships.find((m) => m.team_id === team.id);
  if (!myMembership) redirect("/login");

  return (
    <>
      <div className="section-head">
        <div>
          <h1>My <em>account</em></h1>
          <div className="kicker" style={{ marginTop: 8 }}>
            {session.user.display_name || session.user.email} · {team.name} ·
            personal settings for this seat
          </div>
        </div>
      </div>

      <PairCliPanel teamSlug={slug} />
    </>
  );
}
