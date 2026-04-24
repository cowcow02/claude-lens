import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "../../../../lib/route-helpers";
import { getStatus } from "../../../../lib/self-update/service";

export async function GET(req: NextRequest) {
  const ctx = await requireStaff(req);
  if (ctx instanceof NextResponse) return ctx;
  const status = await getStatus();
  return NextResponse.json(status);
}
