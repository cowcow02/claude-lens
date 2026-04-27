"use client";

import Link from "next/link";
import { useState } from "react";
import type { DayOutcome } from "@claude-lens/entries";
import { OutcomePill, OUTCOME_STYLES } from "./outcome-pill";
import { BackfillDrawer } from "./backfill-drawer";

export type DayRow = {
  date: string;
  day_label: string;
  entry_count: number;
  agent_min: number;
  pr_count: number;
  status: "generated" | "pending" | "empty";
  outcome: DayOutcome | null;
  headline: string | null;
};

export function DayIndex({ rows, aiEnabled }: { rows: DayRow[]; aiEnabled: boolean }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pendingCount = rows.filter((r) => r.status === "pending").length;

  return (
    <>
      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 14,
          alignItems: "center",
        }}
      >
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          style={{
            padding: "6px 12px",
            background: "var(--af-accent)",
            color: "white",
            border: "none",
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Backfill digests
          {pendingCount > 0 && (
            <span style={{ marginLeft: 6, opacity: 0.8 }}>({pendingCount} pending)</span>
          )}
        </button>
        <span style={{ fontSize: 11, color: "var(--af-text-tertiary)" }}>
          Generates narratives for multiple days at once. Closes safely — progress shows in the
          job queue widget.
        </span>
      </div>

      <div className="af-panel">
        {rows.map((r) => {
          const isToday = r.day_label === "Today";
          return (
            <Link
              key={r.date}
              href={`/day/${r.date}`}
              style={{
                display: "grid",
                gridTemplateColumns: "120px 90px 90px 60px 60px 1fr",
                gap: 12,
                alignItems: "center",
                padding: "10px 18px",
                borderBottom: "1px solid var(--af-border-subtle)",
                textDecoration: "none",
                color: "var(--af-text)",
                fontSize: 12,
                background: isToday ? "var(--af-surface-hover)" : "transparent",
              }}
            >
              <span style={{ fontWeight: 500 }}>{r.day_label}</span>
              <span
                style={{ fontSize: 10, color: "var(--af-text-tertiary)", fontFamily: "var(--font-mono)" }}
              >
                {r.date}
              </span>
              <StatusBadge status={r.status} />
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--af-text-tertiary)",
                }}
              >
                {r.entry_count > 0 ? `${r.entry_count} sess` : "—"}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--af-text-tertiary)",
                  textAlign: "right",
                }}
              >
                {r.pr_count > 0 ? `${r.pr_count} PR` : ""}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                {r.outcome && (
                  <span style={{ fontSize: 14, lineHeight: 1, flexShrink: 0 }} aria-hidden>
                    {OUTCOME_STYLES[r.outcome]?.icon}
                  </span>
                )}
                <span
                  style={{
                    fontSize: 12,
                    color: r.headline ? "var(--af-text-secondary)" : "var(--af-text-tertiary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    fontStyle: r.headline ? "normal" : "italic",
                  }}
                  title={r.headline ?? ""}
                >
                  {r.headline ?? (r.status === "empty" ? "(no activity)" : "(no narrative yet)")}
                </span>
              </div>
            </Link>
          );
        })}
      </div>

      <BackfillDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        rows={rows}
        aiEnabled={aiEnabled}
      />
    </>
  );
}

function StatusBadge({ status }: { status: DayRow["status"] }) {
  const map = {
    generated: { fg: "#48bb78", bg: "rgba(72,187,120,0.12)", label: "✓ ready" },
    pending: { fg: "#ed8936", bg: "rgba(237,137,54,0.12)", label: "• pending" },
    empty: { fg: "var(--af-text-tertiary)", bg: "transparent", label: "—" },
  } as const;
  const s = map[status];
  return (
    <span
      style={{
        fontSize: 10,
        padding: "1px 8px",
        borderRadius: 99,
        background: s.bg,
        color: s.fg,
        fontWeight: 600,
        textAlign: "center",
        whiteSpace: "nowrap",
      }}
    >
      {s.label}
    </span>
  );
}

// Re-export for OutcomePill consumers that want the type.
export type { DayOutcome };
// Keep a no-op import so the bundler doesn't tree-shake the component.
void OutcomePill;
