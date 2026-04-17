import { NextRequest, NextResponse } from "next/server";
import { getPool } from "../../../../db/pool";
import { resolveMembershipFromBearer } from "../../../../lib/auth";
import { revokeMembership } from "../../../../lib/members";

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
  }
  const token = authHeader.slice(7);
  const pool = getPool();
  const membership = await resolveMembershipFromBearer(token, pool);
  if (!membership) {
    return NextResponse.json({ error: "Invalid or revoked token" }, { status: 401 });
  }

  await revokeMembership(membership.id, pool);
  return NextResponse.json({ ok: true });
}
