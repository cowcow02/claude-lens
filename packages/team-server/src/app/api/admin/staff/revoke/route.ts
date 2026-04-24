import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "../../../../../lib/route-helpers";
import { getPool } from "../../../../../db/pool";
import { revokeStaff, LastStaffError } from "../../../../../lib/staff";
import { rateLimit } from "../../../../../lib/rate-limit";

export async function POST(req: NextRequest) {
  const ctx = await requireStaff(req);
  if (ctx instanceof NextResponse) return ctx;

  const rl = rateLimit(`staff-mutate:${ctx.user.id}`, 10, 60 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many staff changes. Try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.retryAfterMs ?? 60_000) / 1000)) } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { targetUserId?: unknown };
  const targetUserId = typeof body.targetUserId === "string" ? body.targetUserId : "";
  if (!targetUserId) {
    return NextResponse.json({ error: "targetUserId required" }, { status: 400 });
  }

  try {
    await revokeStaff(targetUserId, ctx.user.id, getPool());
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof LastStaffError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
