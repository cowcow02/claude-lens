import { redirect } from "next/navigation";
import { todayLocal } from "@/lib/entries";

export const dynamic = "force-dynamic";

export default function DayIndexRedirect() {
  redirect(`/day/${todayLocal()}`);
}
