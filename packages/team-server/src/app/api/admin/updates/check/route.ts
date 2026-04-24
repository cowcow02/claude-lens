import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "../../../../../lib/route-helpers";
import { checkNow } from "../../../../../lib/self-update/service";

export async function POST(req: NextRequest) {
  const ctx = await requireStaff(req);
  if (ctx instanceof NextResponse) return ctx;
  try {
    const status = await checkNow();
    return NextResponse.json(status);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
