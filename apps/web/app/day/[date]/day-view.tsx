"use client";

import { useEffect, useState } from "react";
import type { DayDigest, Entry } from "@claude-lens/entries";
import type { GanttDay, ParallelismBurst } from "@claude-lens/parser";
import { DayDigestView } from "@/components/day-digest-view";
import { GanttChart, type SessionEntrySummary } from "../../parallelism/gantt-chart";

type Tab = "narrative" | "timeline";

const VALID_TABS: Tab[] = ["narrative", "timeline"];

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
  const [tab, setTab] = useState<Tab>("narrative");

  // Read tab from URL hash on mount + on hashchange.
  useEffect(() => {
    const readHash = (): Tab => {
      const h = (typeof window !== "undefined" ? window.location.hash.replace("#", "") : "") as Tab;
      return VALID_TABS.includes(h) ? h : "narrative";
    };
    setTab(readHash());
    const onHash = () => setTab(readHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const switchTab = (next: Tab) => {
    setTab(next);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `#${next}`);
    }
  };

  const hasTimeline = gantt.sessions.length > 0;

  return (
    <>
      <div
        style={{
          display: "flex",
          gap: 0,
          padding: "0 40px",
          borderBottom: "1px solid var(--af-border-subtle)",
        }}
      >
        <TabBtn active={tab === "narrative"} onClick={() => switchTab("narrative")}>
          Narrative
        </TabBtn>
        <TabBtn
          active={tab === "timeline"}
          onClick={() => switchTab("timeline")}
          disabled={!hasTimeline}
        >
          Timeline
        </TabBtn>
      </div>

      {tab === "narrative" && (
        <DayDigestView initial={initial} entries={entries} date={date} aiEnabled={aiEnabled} />
      )}

      {tab === "timeline" && hasTimeline && (
        <div style={{ padding: "20px 40px" }}>
          <GanttChart gantt={gantt} bursts={bursts} sessionEntries={sessionEntries} />
        </div>
      )}

      {tab === "timeline" && !hasTimeline && (
        <div style={{ padding: 40, textAlign: "center", color: "var(--af-text-tertiary)" }}>
          No active sessions on {date}.
        </div>
      )}
    </>
  );
}

function TabBtn({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "10px 18px",
        background: "transparent",
        border: "none",
        borderBottom: active ? "2px solid var(--af-accent)" : "2px solid transparent",
        color: active ? "var(--af-text)" : "var(--af-text-tertiary)",
        fontSize: 13,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        marginBottom: -1,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {children}
    </button>
  );
}
