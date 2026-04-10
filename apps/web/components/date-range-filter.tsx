"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { RangeKey } from "@/lib/date-range";

export type { RangeKey };

const OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "7d", label: "7D" },
  { key: "30d", label: "30D" },
  { key: "90d", label: "90D" },
  { key: "all", label: "All" },
];

/**
 * Tiny segmented control that writes the current range into a
 * `?range=` search param. Pages read it server-side in `searchParams`
 * and filter `listSessions()` accordingly. No client-side state — the
 * URL is the source of truth, so navigation + reload + share all work.
 */
export function DateRangeFilter({ current }: { current: RangeKey }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const pick = (next: RangeKey) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (next === "all") params.delete("range");
    else params.set("range", next);
    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
  };

  return (
    <div
      style={{
        display: "inline-flex",
        gap: 2,
        background: "var(--background)",
        borderRadius: 7,
        padding: 3,
        border: "1px solid var(--af-border-subtle)",
      }}
    >
      {OPTIONS.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => pick(o.key)}
          style={{
            fontSize: 11,
            padding: "4px 10px",
            border: "none",
            borderRadius: 5,
            background: current === o.key ? "var(--af-surface-elevated)" : "transparent",
            color: current === o.key ? "var(--af-text)" : "var(--af-text-tertiary)",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

