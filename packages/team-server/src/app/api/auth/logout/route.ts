import { NextRequest, NextResponse } from "next/server";
import { getPool } from "../../../../db/pool";
import { validateSession, revokeSession } from "../../../../lib/auth";

export async function POST(req: NextRequest) {
  const token = req.cookies.get("fleetlens_session")?.value;
  if (token) {
    const ctx = await validateSession(token, getPool());
    if (ctx) await revokeSession(ctx.sessionId, getPool());
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.delete("fleetlens_session");
  return res;
}
