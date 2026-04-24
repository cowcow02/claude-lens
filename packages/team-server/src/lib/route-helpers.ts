import { NextRequest, NextResponse } from "next/server";
import type pg from "pg";
import { getPool } from "../db/pool";
import { validateSession, type SessionContext } from "./auth";

export type TeamContext = SessionContext & {
  pool: pg.Pool;
  membership: { id: string; team_id: string; role: "admin" | "member" };
};

export async function requireSession(req: NextRequest): Promise<(SessionContext & { pool: pg.Pool }) | NextResponse> {
  const cookieToken = req.cookies.get("fleetlens_session")?.value;
  if (!cookieToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const pool = getPool();
  const ctx = await validateSession(cookieToken, pool);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  return { ...ctx, pool };
}

export async function requireTeamMembership(
  req: NextRequest,
  teamIdOrSlug: string,
  { bySlug = false }: { bySlug?: boolean } = {},
): Promise<TeamContext | NextResponse> {
  const base = await requireSession(req);
  if (base instanceof NextResponse) return base;

  let resolvedId = teamIdOrSlug;
  if (bySlug) {
    const slugRes = await base.pool.query("SELECT id FROM teams WHERE slug = $1", [teamIdOrSlug]);
    if (!slugRes.rowCount) return NextResponse.json({ error: "Team not found" }, { status: 404 });
    resolvedId = slugRes.rows[0].id;
  }

  const membership = base.memberships.find((m) => m.team_id === resolvedId);
  if (!membership) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  return {
    ...base,
    membership: { id: membership.id, team_id: membership.team_id, role: membership.role },
  };
}

export function requireAdmin(ctx: TeamContext): NextResponse | null {
  if (ctx.membership.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });
  return null;
}

export async function requireStaff(
  req: NextRequest,
): Promise<(SessionContext & { pool: pg.Pool }) | NextResponse> {
  const base = await requireSession(req);
  if (base instanceof NextResponse) return base;
  if (!base.user.is_staff) return NextResponse.json({ error: "Staff only" }, { status: 403 });
  return base;
}
