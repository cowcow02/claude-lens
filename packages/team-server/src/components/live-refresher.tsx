"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function LiveRefresher() {
  const router = useRouter();

  useEffect(() => {
    const es = new EventSource("/api/sse/updates");
    es.addEventListener("roster-updated", () => {
      router.refresh();
    });
    return () => es.close();
  }, [router]);

  return null;
}
