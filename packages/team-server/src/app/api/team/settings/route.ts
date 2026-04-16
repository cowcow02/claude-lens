import { NextRequest, NextResponse } from "next/server";
import { getPool } from "../../../../db/pool.js";
import { validateAdminSession } from "../../../../lib/auth.js";

export async function GET(req: NextRequest) {
  const cookieToken = req.cookies.get("fleetlens_session")?.value;
  if (!cookieToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const pool = getPool();
  const session = await validateAdminSession(cookieToken, pool);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const memberRes = await pool.query("SELECT team_id, role FROM members WHERE id = $1", [session.memberId]);
  if (memberRes.rows[0]?.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const teamRes = await pool.query(
    "SELECT name, slug, retention_days, custom_domain, settings, created_at FROM teams WHERE id = $1",
    [memberRes.rows[0].team_id]
  );

  return NextResponse.json(teamRes.rows[0]);
}

export async function PUT(req: NextRequest) {
  const cookieToken = req.cookies.get("fleetlens_session")?.value;
  if (!cookieToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const pool = getPool();
  const session = await validateAdminSession(cookieToken, pool);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const memberRes = await pool.query("SELECT team_id, role FROM members WHERE id = $1", [session.memberId]);
  if (memberRes.rows[0]?.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const body = await req.json();
  const teamId = memberRes.rows[0].team_id;

  if (body.name) {
    await pool.query("UPDATE teams SET name = $1 WHERE id = $2", [body.name, teamId]);
  }
  if (body.retentionDays) {
    await pool.query("UPDATE teams SET retention_days = $1 WHERE id = $2", [body.retentionDays, teamId]);
  }

  return NextResponse.json({ updated: true });
}
