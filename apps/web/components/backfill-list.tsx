"use client";

import { useState } from "react";
import Link from "next/link";
import type { BackfillRow } from "@/app/digest/page";

type JobState = {
  date: string;
  phase: "queued" | "enrich" | "synth" | "done" | "error";
  text: string;
  index?: number;
  total?: number;
  bytes?: number;
  elapsed_ms?: number;
  errorMsg?: string;
};

export function BackfillList({ rows, aiEnabled }: { rows: BackfillRow[]; aiEnabled: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [jobs, setJobs] = useState<JobState[]>([]);
  const [rowsState, setRowsState] = useState<BackfillRow[]>(rows);

  const toggleDay = (d: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  };

  const selectAllPending = () => {
    setSelected(new Set(rowsState.filter(r => r.status === "pending").map(r => r.date)));
  };
  const selectAllMissing = () => {
    setSelected(new Set(rowsState.filter(r => r.status !== "empty").map(r => r.date)));
  };
  const clearSelection = () => setSelected(new Set());

  const runBatch = async (force: boolean) => {
    if (selected.size === 0) return;
    const dates = Array.from(selected).sort().reverse();  // most recent first
    setRunning(true);
    setJobs(dates.map(d => ({ date: d, phase: "queued", text: "queued" })));

    for (let i = 0; i < dates.length; i++) {
      const d = dates[i]!;
      updateJob(d, { phase: "enrich", text: "starting" });
      try {
        const url = `/api/digest/day/${d}${force ? "?force=1" : ""}`;
        const res = await fetch(url, { method: "POST" });
        if (!res.ok || !res.body) {
          updateJob(d, { phase: "error", text: `HTTP ${res.status}`, errorMsg: `HTTP ${res.status}` });
          continue;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const frames = buf.split("\n\n");
          buf = frames.pop() ?? "";
          for (const frame of frames) {
            const dataLine = frame.split("\n").find(l => l.startsWith("data: "));
            if (!dataLine) continue;
            try {
              const ev = JSON.parse(dataLine.slice(6));
              if (ev.type === "status") updateJob(d, { phase: ev.phase, text: ev.text });
              else if (ev.type === "entry") updateJob(d, { phase: "enrich", text: `entry ${ev.index}/${ev.total}`, index: ev.index, total: ev.total });
              else if (ev.type === "progress") updateJob(d, { phase: "synth", text: `composing ${Math.round(ev.elapsed_ms/1000)}s`, bytes: ev.bytes, elapsed_ms: ev.elapsed_ms });
              else if (ev.type === "digest") updateJob(d, { phase: "done", text: "digest ready" });
              else if (ev.type === "saved") updateJob(d, { phase: "done", text: "saved" });
              else if (ev.type === "error") updateJob(d, { phase: "error", text: ev.message, errorMsg: ev.message });
            } catch { /* skip */ }
          }
        }
        // Flip row state to "generated" locally.
        setRowsState(prev => prev.map(r => r.date === d ? { ...r, status: "generated" } : r));
      } catch (e) {
        updateJob(d, { phase: "error", text: (e as Error).message, errorMsg: (e as Error).message });
      }
    }
    setRunning(false);
  };

  const updateJob = (date: string, patch: Partial<JobState>) => {
    setJobs(prev => prev.map(j => j.date === date ? { ...j, ...patch } : j));
  };

  const missingCount = rowsState.filter(r => r.status === "pending").length;

  return (
    <div>
      {!aiEnabled && (
        <div style={{
          padding: 12, marginBottom: 20, background: "var(--af-accent-subtle)",
          borderRadius: 8, fontSize: 13,
        }}>
          AI features are disabled. Enable in <Link href="/settings" style={{ color: "var(--af-accent)" }}>Settings</Link> before generating.
        </div>
      )}

      {/* Bulk actions */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={selectAllPending} disabled={running} style={actionBtnStyle}>
          Select pending ({missingCount})
        </button>
        <button onClick={selectAllMissing} disabled={running} style={actionBtnStyle}>
          Select all with entries
        </button>
        <button onClick={clearSelection} disabled={running || selected.size === 0} style={actionBtnStyle}>
          Clear
        </button>
        <span style={{ flex: 1 }} />
        <button
          onClick={() => runBatch(false)}
          disabled={running || selected.size === 0 || !aiEnabled}
          style={{ ...primaryBtnStyle, opacity: (running || selected.size === 0 || !aiEnabled) ? 0.5 : 1 }}
        >
          Generate {selected.size > 0 ? `(${selected.size})` : ""}
        </button>
        <button
          onClick={() => runBatch(true)}
          disabled={running || selected.size === 0 || !aiEnabled}
          style={{ ...secondaryBtnStyle, opacity: (running || selected.size === 0 || !aiEnabled) ? 0.5 : 1 }}
          title="Force-regenerate — rescues stuck entries and overwrites cached digests"
        >
          Force
        </button>
      </div>

      {/* Progress panel */}
      {jobs.length > 0 && (
        <div style={{
          marginBottom: 18, padding: "14px 16px",
          background: "var(--af-surface)", border: "1px solid var(--af-border-subtle)",
          borderRadius: 8,
        }}>
          <div style={{ fontSize: 11, color: "var(--af-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 10 }}>
            {running ? "Running" : "Complete"}
          </div>
          {jobs.map(j => <JobRow key={j.date} job={j} />)}
        </div>
      )}

      {/* Day list */}
      <div style={{ border: "1px solid var(--af-border-subtle)", borderRadius: 8 }}>
        {rowsState.map(r => {
          const isSelected = selected.has(r.date);
          const canSelect = r.status !== "empty";
          return (
            <div
              key={r.date}
              style={{
                display: "grid",
                gridTemplateColumns: "28px 120px 56px 1fr 56px 56px 120px",
                gap: 14, alignItems: "center", padding: "10px 14px",
                borderBottom: "1px solid var(--af-border-subtle)",
                fontSize: 13, opacity: canSelect ? 1 : 0.55,
              }}
            >
              <input
                type="checkbox"
                checked={isSelected}
                disabled={!canSelect || running}
                onChange={() => canSelect && toggleDay(r.date)}
              />
              <span>{r.day_label}</span>
              <StatusPill status={r.status} />
              <span style={{ color: "var(--af-text-secondary)", fontSize: 11, fontFamily: "var(--font-mono)" }}>
                {r.entry_count > 0 ? `${r.entry_count} entr${r.entry_count === 1 ? "y" : "ies"}` : "no activity"}
              </span>
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--af-text-tertiary)", fontSize: 11, textAlign: "right" }}>
                {r.agent_min > 0 ? `${Math.round(r.agent_min)}m` : ""}
              </span>
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--af-text-tertiary)", fontSize: 11, textAlign: "right" }}>
                {r.pr_count > 0 ? `${r.pr_count} PR${r.pr_count === 1 ? "" : "s"}` : ""}
              </span>
              <Link href={`/digest/${r.date}`} style={{ fontSize: 11, color: "var(--af-accent)", textAlign: "right" }}>
                Open →
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function JobRow({ job }: { job: JobState }) {
  const color = job.phase === "done" ? "#48bb78"
    : job.phase === "error" ? "#f56565"
    : "var(--af-accent)";
  const pct = job.total && job.index ? Math.round((job.index / job.total) * 100) : null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "100px 72px 1fr", gap: 12, padding: "4px 0", fontSize: 12, alignItems: "center" }}>
      <span style={{ fontFamily: "var(--font-mono)", color: "var(--af-text-secondary)" }}>{job.date}</span>
      <span style={{ color, fontWeight: 600, fontSize: 11 }}>{job.phase}</span>
      <span style={{ color: "var(--af-text-tertiary)", fontSize: 11 }}>
        {job.text}{pct !== null ? ` · ${pct}%` : ""}
        {job.bytes !== undefined && ` · ${job.bytes.toLocaleString()} chars`}
      </span>
    </div>
  );
}

function StatusPill({ status }: { status: BackfillRow["status"] }) {
  const style = {
    generated: { bg: "rgba(72,187,120,0.12)", fg: "#48bb78", text: "✓" },
    pending:   { bg: "rgba(237,137,54,0.12)", fg: "#ed8936", text: "•" },
    empty:     { bg: "transparent",            fg: "var(--af-text-tertiary)", text: "—" },
  }[status];
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, padding: "1px 7px", borderRadius: 99,
      background: style.bg, color: style.fg, minWidth: 22, textAlign: "center",
    }}>
      {style.text}
    </span>
  );
}

const actionBtnStyle: React.CSSProperties = {
  padding: "5px 10px", fontSize: 11, borderRadius: 6,
  border: "1px solid var(--af-border-subtle)", background: "transparent",
  color: "var(--af-text)", cursor: "pointer",
};
const primaryBtnStyle: React.CSSProperties = {
  padding: "6px 14px", fontSize: 12, borderRadius: 6,
  border: "none", background: "var(--af-accent)", color: "white", cursor: "pointer",
  fontWeight: 600,
};
const secondaryBtnStyle: React.CSSProperties = {
  padding: "6px 14px", fontSize: 12, borderRadius: 6,
  border: "1px solid var(--af-border-subtle)", background: "transparent",
  color: "var(--af-text)", cursor: "pointer",
};
