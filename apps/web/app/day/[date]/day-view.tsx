"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CalendarDays, ChevronDown, ChevronRight, Layers } from "lucide-react";
import type { DayDigest, Entry } from "@claude-lens/entries";
import type { GanttDay, ParallelismBurst } from "@claude-lens/parser";
import { DayDigestView } from "@/components/day-digest-view";
import { GanttChart, type SessionEntrySummary } from "../../parallelism/gantt-chart";
import { BackfillDrawer, type BackfillRow } from "@/components/backfill-drawer";

export function DayView({
  date,
  today,
  prev,
  next,
  initial,
  entries,
  aiEnabled,
  gantt,
  bursts,
  sessionEntries,
  backfillRows,
}: {
  date: string;
  today: string;
  prev: string;
  next: string | null;
  initial: DayDigest | null;
  entries: Entry[];
  aiEnabled: boolean;
  gantt: GanttDay;
  bursts: ParallelismBurst[];
  sessionEntries: Record<string, SessionEntrySummary>;
  backfillRows: BackfillRow[];
}) {
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const hasNarrative = entries.length > 0;
  const hasTimeline = gantt.sessions.length > 0;

  const onPickDate = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    if (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && v <= today) {
      router.push(`/day/${v}`);
    }
  };

  const fmtDate = new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });

  const pendingCount = backfillRows.filter((r) => r.status === "pending").length;

  return (
    <>
      <nav
        style={{
          padding: "14px 40px",
          display: "flex",
          gap: 12,
          fontSize: 12,
          borderBottom: "1px solid var(--af-border-subtle)",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <Link href={`/day/${prev}`} style={{ color: "var(--af-accent)" }}>← Prev</Link>
        {next && <Link href={`/day/${next}`} style={{ color: "var(--af-accent)" }}>Next →</Link>}
        {date !== today && (
          <Link href={`/day/${today}`} style={{ color: "var(--af-accent)" }}>Today</Link>
        )}

        <span style={{ color: "var(--af-text-tertiary)", marginLeft: 4 }}>·</span>

        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            color: "var(--af-text-secondary)",
            cursor: "pointer",
          }}
          title="Pick a date"
        >
          <CalendarDays size={13} />
          <input
            type="date"
            value={date}
            max={today}
            onChange={onPickDate}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--af-text)",
              fontSize: 12,
              fontFamily: "inherit",
              padding: 0,
              cursor: "pointer",
            }}
          />
        </label>

        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          style={{
            marginLeft: "auto",
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "5px 10px",
            background: "transparent",
            border: "1px solid var(--af-border-subtle)",
            borderRadius: 6,
            fontSize: 11,
            color: "var(--af-text-secondary)",
            cursor: "pointer",
          }}
          title="Open the backfill multi-select drawer"
        >
          <Layers size={12} />
          Backfill digests
          {pendingCount > 0 && (
            <span
              style={{
                fontSize: 10,
                color: "#ed8936",
                fontWeight: 700,
              }}
            >
              {pendingCount}
            </span>
          )}
        </button>
      </nav>

      {!hasNarrative && !hasTimeline ? (
        <div
          style={{
            padding: "60px 40px",
            textAlign: "center",
            color: "var(--af-text-secondary)",
          }}
        >
          <div style={{ fontSize: 14, marginBottom: 6 }}>{fmtDate}</div>
          <div style={{ fontSize: 13, color: "var(--af-text-tertiary)" }}>
            No Claude Code activity on this day.
          </div>
        </div>
      ) : (
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
      )}

      <BackfillDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        rows={backfillRows}
        aiEnabled={aiEnabled}
      />
    </>
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
