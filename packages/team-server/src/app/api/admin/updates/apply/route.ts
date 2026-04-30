import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "../../../../../lib/route-helpers";
import { applyUpdate } from "../../../../../lib/self-update/service";

export async function POST(req: NextRequest) {
  const ctx = await requireStaff(req);
  if (ctx instanceof NextResponse) return ctx;
  const body = await req.json().catch(() => ({}));
  const { version } = body as { version?: string };
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    return NextResponse.json({ error: "Invalid version" }, { status: 400 });
  }
  try {
    const result = await applyUpdate(version, ctx.user.id);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
