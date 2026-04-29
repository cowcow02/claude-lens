import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPool } from "../../../../../db/pool";
import { validateSession } from "../../../../../lib/auth";
import { loadMember, loadMemberRollups } from "../../../../../lib/queries";
import { loadMemberPlanSummary, loadMembership7dCyclePeaks } from "../../../../../lib/plan-queries";
import { MemberProfile } from "../../../../../components/member-profile";
import { MemberPlanBlock } from "../../../../../components/member-plan-block";
import { CyclePeaksStrip } from "../../../../../components/cycle-peaks-strip";

export default async function MemberPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const pool = getPool();

  const cookieStore = await cookies();
  const token = cookieStore.get("fleetlens_session")?.value;
  const session = token ? await validateSession(token, pool) : null;
  if (!session) redirect("/login");

  const member = await loadMember(id, pool);
  if (!member) return <div>Member not found.</div>;

  const myMembership = session.memberships.find((m) => m.team_id === member.team_id);
  if (!myMembership) redirect("/login");

  // Members can only view their own profile; admins can view anyone.
  const isSelf = myMembership.id === id;
  if (myMembership.role !== "admin" && !isSelf) {
    return (
      <div className="section-head">
        <div>
          <h1>Not <em>authorized</em></h1>
          <div className="kicker" style={{ marginTop: 8 }}>
            You can only view your own profile on this team.
          </div>
        </div>
      </div>
    );
  }

  const [rollups, planSummary, allCyclePeaks] = await Promise.all([
    loadMemberRollups(member.team_id, id, 30, pool),
    loadMemberPlanSummary(member.team_id, id, pool),
    loadMembership7dCyclePeaks(member.team_id, pool),
  ]);
  const cyclePeaks = allCyclePeaks.get(id) ?? [];
  const canSeeRoster = myMembership.role === "admin";

  return (
    <>
      {canSeeRoster ? (
        <a href={`/team/${slug}`} className="kicker" style={{ display: "inline-block", marginBottom: 24, color: "var(--mute)" }}>
          ← Back to roster
        </a>
      ) : (
        <div className="kicker" style={{ display: "inline-block", marginBottom: 24, color: "var(--mute)" }}>
          Your profile
        </div>
      )}
      <MemberProfile member={member} rollups={rollups} />
      {cyclePeaks.length > 0 && (
        <section className="settings-section">
          <div className="subsection-head">
            <h2>Previous 7d cycles</h2>
            <span className="kicker">
              Same data the member sees on their personal /usage page
            </span>
          </div>
          <CyclePeaksStrip cycles={cyclePeaks} maxBars={12} />
        </section>
      )}
      <MemberPlanBlock summary={planSummary} />
    </>
  );
}
