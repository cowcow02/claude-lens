import { listSavedReports } from "@/lib/ai/saved-reports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const reports = await listSavedReports();
  return Response.json({ reports });
}
