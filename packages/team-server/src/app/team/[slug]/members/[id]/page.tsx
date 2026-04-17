import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPool } from "../../../../../db/pool";
import { validateSession } from "../../../../../lib/auth";
import { loadMember, loadMemberRollups } from "../../../../../lib/queries";
import { MemberProfile } from "../../../../../components/member-profile";

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

  const rollups = await loadMemberRollups(member.team_id, id, 30, pool);
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
    </>
  );
}
