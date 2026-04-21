import { getSavedReport } from "@/lib/ai/saved-reports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  const report = await getSavedReport(key);
  if (!report) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ report });
}
