import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireTeamMembership, requireAdmin } from "../../../../../lib/route-helpers";
import { loadMember, loadMemberRollups } from "../../../../../lib/queries";
import { revokeMembership } from "../../../../../lib/members";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession(req);
  if (session instanceof NextResponse) return session;

  const { id } = await params;
  const member = await loadMember(id, session.pool);
  if (!member) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const myMembership = session.memberships.find((m) => m.team_id === member.team_id);
  if (!myMembership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Members can only read their own profile; admins can read anyone.
  if (myMembership.role !== "admin" && myMembership.id !== id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rollups = await loadMemberRollups(member.team_id, id, 30, session.pool);
  return NextResponse.json({ member, rollups });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSession(req);
  if (session instanceof NextResponse) return session;

  const { id } = await params;
  const member = await loadMember(id, session.pool);
  if (!member) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const ctx = await requireTeamMembership(req, member.team_id);
  if (ctx instanceof NextResponse) return ctx;
  const adminErr = requireAdmin(ctx);
  if (adminErr) return adminErr;

  await revokeMembership(id, session.pool);
  await session.pool.query(
    "INSERT INTO events (team_id, actor_id, action, payload) VALUES ($1, $2, 'member.revoke', $3)",
    [member.team_id, session.user.id, JSON.stringify({ membershipId: id })]
  );
  return NextResponse.json({ revoked: true });
}
