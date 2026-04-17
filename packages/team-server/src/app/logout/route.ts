import { NextRequest, NextResponse } from "next/server";
import { getPool } from "../../db/pool";
import { validateSession, revokeSession } from "../../lib/auth";

async function handle(req: NextRequest) {
  const token = req.cookies.get("fleetlens_session")?.value;
  if (token) {
    const ctx = await validateSession(token, getPool());
    if (ctx) await revokeSession(ctx.sessionId, getPool());
  }
  const base = process.env.BASE_URL || `${req.headers.get("x-forwarded-proto") || "http"}://${req.headers.get("host")}`;
  const res = NextResponse.redirect(new URL("/login", base));
  res.cookies.delete("fleetlens_session");
  return res;
}

export const GET = handle;
export const POST = handle;
