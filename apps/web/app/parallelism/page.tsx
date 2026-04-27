import { redirect } from "next/navigation";
import { todayLocal } from "@/lib/entries";

export const dynamic = "force-dynamic";

export default async function LegacyTimelineRedirect({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const { date: dateParam } = await searchParams;
  const date = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayLocal();
  // Hash fragment for the timeline tab is best-effort — most browsers
  // preserve it across server redirects.
  redirect(`/day/${date}#timeline`);
}
