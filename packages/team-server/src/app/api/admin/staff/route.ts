import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "../../../../lib/route-helpers";
import { getPool } from "../../../../db/pool";
import { listStaff } from "../../../../lib/staff";

export async function GET(req: NextRequest) {
  const ctx = await requireStaff(req);
  if (ctx instanceof NextResponse) return ctx;
  const users = await listStaff(getPool());
  return NextResponse.json({ users });
}
