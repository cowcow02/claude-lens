"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { DayDigest, Entry } from "@claude-lens/entries";
import type { GanttDay, ParallelismBurst } from "@claude-lens/parser";
import { DayDigestView } from "@/components/day-digest-view";
import { GanttChart, type SessionEntrySummary } from "../../parallelism/gantt-chart";

export function DayView({
  date,
  initial,
  entries,
  aiEnabled,
  gantt,
  bursts,
  sessionEntries,
}: {
  date: string;
  initial: DayDigest | null;
  entries: Entry[];
  aiEnabled: boolean;
  gantt: GanttDay;
  bursts: ParallelismBurst[];
  sessionEntries: Record<string, SessionEntrySummary>;
}) {
  const hasNarrative = entries.length > 0;
  const hasTimeline = gantt.sessions.length > 0;

  // Empty day: nothing to show. Concise panel — no dead CTAs.
  if (!hasNarrative && !hasTimeline) {
    const fmtDate = new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
      weekday: "long", month: "long", day: "numeric", year: "numeric",
    });
    return (
      <div style={{ padding: "60px 40px", textAlign: "center", color: "var(--af-text-secondary)" }}>
        <div style={{ fontSize: 14, marginBottom: 6 }}>{fmtDate}</div>
        <div style={{ fontSize: 13, color: "var(--af-text-tertiary)" }}>
          No Claude Code activity on this day.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {hasNarrative && (
        <Section label="Narrative" defaultOpen>
          <DayDigestView
            initial={initial}
            entries={entries}
            date={date}
            aiEnabled={aiEnabled}
          />
        </Section>
      )}
      {hasTimeline && (
        <Section label="Timeline & concurrency" defaultOpen>
          <div style={{ padding: "8px 40px 40px" }}>
            <GanttChart gantt={gantt} bursts={bursts} sessionEntries={sessionEntries} />
          </div>
        </Section>
      )}
    </div>
  );
}

function Section({
  label,
  defaultOpen = true,
  children,
}: {
  label: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: "1px solid var(--af-border-subtle)" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          padding: "12px 40px",
          background: "transparent",
          border: "none",
          textAlign: "left",
          display: "flex",
          alignItems: "center",
          gap: 8,
          cursor: "pointer",
          fontSize: 11,
          fontWeight: 700,
          color: "var(--af-text-tertiary)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        {label}
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}
