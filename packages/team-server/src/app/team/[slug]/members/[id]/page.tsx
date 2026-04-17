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
  if (!session.memberships.some((m) => m.team_id === member.team_id)) redirect("/login");

  const rollups = await loadMemberRollups(member.team_id, id, 30, pool);

  return (
    <>
      <a href={`/team/${slug}`} className="kicker" style={{ display: "inline-block", marginBottom: 24, color: "var(--mute)" }}>
        ← Back to roster
      </a>
      <MemberProfile member={member} rollups={rollups} />
    </>
  );
}
