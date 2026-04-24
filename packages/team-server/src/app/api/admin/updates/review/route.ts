import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "../../../../../lib/route-helpers";
import { getReview } from "../../../../../lib/self-update/service";

export async function GET(req: NextRequest) {
  const ctx = await requireStaff(req);
  if (ctx instanceof NextResponse) return ctx;
  const version = req.nextUrl.searchParams.get("version");
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    return NextResponse.json({ error: "Invalid version" }, { status: 400 });
  }
  try {
    const review = await getReview(version);
    return NextResponse.json(review);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
