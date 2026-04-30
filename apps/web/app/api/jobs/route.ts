import { listRecentJobs } from "@/lib/jobs";

export const dynamic = "force-dynamic";

export async function GET() {
  const jobs = listRecentJobs(30);
  return Response.json({ jobs });
}
