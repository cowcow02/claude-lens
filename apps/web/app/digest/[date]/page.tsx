import { redirect } from "next/navigation";
import { isValidDate } from "@/lib/entries";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function LegacyDigestRedirect({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  if (!isValidDate(date)) return notFound();
  redirect(`/day/${date}`);
}
