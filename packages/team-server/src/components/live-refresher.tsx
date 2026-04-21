"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function LiveRefresher({ teamSlug }: { teamSlug: string }) {
  const router = useRouter();
  useEffect(() => {
    const es = new EventSource(`/api/sse/updates?team=${encodeURIComponent(teamSlug)}`);
    es.addEventListener("roster-updated", () => router.refresh());
    return () => es.close();
  }, [router, teamSlug]);
  return null;
}
