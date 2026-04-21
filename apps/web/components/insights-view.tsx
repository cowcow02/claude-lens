"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft, CheckCircle2, ChevronRight,
  Circle, Loader2, Square,
} from "lucide-react";
import { priorCalendarWeek } from "@claude-lens/parser";
import { InsightReport, type ReportData } from "@/components/insight-report";
import type { SavedReportMeta } from "@/lib/ai/saved-reports";

type RangeChoice = {
  /** Stable id used for the generating-state label. For picker rows, use `week-YYYY-MM-DD`. */
  id: string;
  label: string;
  /** Body posted to /api/insights. */
  body: { range_type: "prior_week" | "4weeks_completed" | "week" | "4weeks" | "custom"; since?: string; until?: string };
};

type WeekRow = {
  iso_week: number;
  start: string;
  end: string;
  label: string;
  sessions: number;
  in_progress: boolean;
  saved_key: string | null;
  archetype_label?: string;
  sessions_used?: number;
  prs?: number;
};

type PhaseId = "data" | "analyst" | "compose";
type Phase = { id: PhaseId; label: string; status: "pending" | "running" | "done"; steps: string[] };

type InsightsEvent =
  | { type: "status"; phase: PhaseId; text: string }
  | { type: "report"; report: ReportData }
  | { type: "saved"; key: string; saved_at: string }
  | { type: "done" }
  | { type: "error"; message: string };

type View =
  | { kind: "loading_history" }
  | { kind: "history"; saved: SavedReportMeta[] }
  | { kind: "generating"; rangeId: string; label: string; phases: Phase[]; elapsedMs: number }
  | { kind: "report"; report: ReportData; key: string | null }
  | { kind: "error"; message: string };

const INITIAL_PHASES: Phase[] = [
  { id: "data", label: "Gather data", status: "pending", steps: [] },
  { id: "analyst", label: "Claude analyst", status: "pending", steps: [] },
  { id: "compose", label: "Compose report", status: "pending", steps: [] },
];

export function InsightsView() {
  const [view, setView] = useState<View>({ kind: "loading_history" });
  const abortRef = useRef<AbortController | null>(null);
  const startTimerRef = useRef<number | null>(null);

  // Load saved reports on mount
  useEffect(() => {
    void refreshHistory();
  }, []);

  async function refreshHistory() {
    try {
      const res = await fetch("/api/insights/saved");
      const json = await res.json() as { reports: SavedReportMeta[] };
      setView({ kind: "history", saved: json.reports });
    } catch (err) {
      setView({ kind: "error", message: (err as Error).message });
    }
  }

  async function openSaved(key: string) {
    setView({ kind: "loading_history" });
    try {
      const res = await fetch(`/api/insights/saved/${key}`);
      if (!res.ok) { setView({ kind: "error", message: "Report not found" }); return; }
      const json = await res.json() as { report: ReportData };
      setView({ kind: "report", report: json.report, key });
    } catch (err) {
      setView({ kind: "error", message: (err as Error).message });
    }
  }

  const generate = useCallback(async (range: RangeChoice) => {
    const phases: Phase[] = INITIAL_PHASES.map((p) => ({ ...p, steps: [] }));
    phases[0]!.status = "running";
    const startMs = Date.now();
    // Tick only when the whole-second reading changes — avoids re-rendering
    // the phase tree twice a second when nothing visible moved.
    startTimerRef.current = window.setInterval(() => {
      setView((v) => {
        if (v.kind !== "generating") return v;
        const next = Date.now() - startMs;
        if (Math.floor(next / 1000) === Math.floor(v.elapsedMs / 1000)) return v;
        return { ...v, elapsedMs: next };
      });
    }, 500);
    setView({ kind: "generating", rangeId: range.id, label: range.label, phases, elapsedMs: 0 });

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch("/api/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(range.body),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        setView({ kind: "error", message: await res.text() || `HTTP ${res.status}` });
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let done = false;
      let savedKey: string | null = null;
      let report: ReportData | null = null;
      while (!done) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop()!;
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (!raw) continue;
          let data: InsightsEvent;
          try { data = JSON.parse(raw); } catch { continue; }

          if (data.type === "status") {
            const { phase: ph, text: txt } = data;
            setView((v) => {
              if (v.kind !== "generating") return v;
              const next = { ...v, phases: v.phases.map((p) => p.id === ph ? { ...p, steps: [...p.steps] } : p) };
              for (const phase of next.phases) {
                if (phase.id === ph) {
                  phase.status = "running";
                  const last = phase.steps[phase.steps.length - 1];
                  if (last && isSupersedingUpdate(last, txt)) {
                    phase.steps[phase.steps.length - 1] = txt;
                  } else {
                    phase.steps.push(txt);
                  }
                } else if (phaseOrder(phase.id) < phaseOrder(ph)) {
                  phase.status = "done";
                }
              }
              return next;
            });
          } else if (data.type === "report") {
            report = data.report;
          } else if (data.type === "saved") {
            savedKey = data.key;
          } else if (data.type === "done") {
            done = true;
            setView((v) => v.kind === "generating"
              ? { ...v, phases: v.phases.map((p) => ({ ...p, status: "done" as const })) }
              : v);
          } else if (data.type === "error") {
            setView({ kind: "error", message: data.message });
            return;
          }
        }
      }
      if (report) {
        setView({ kind: "report", report, key: savedKey });
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setView({ kind: "error", message: (err as Error).message });
      }
    } finally {
      if (startTimerRef.current) { window.clearInterval(startTimerRef.current); startTimerRef.current = null; }
      abortRef.current = null;
      // If generation succeeded, refresh history in the background so the next
      // return-to-history has this new report.
      setTimeout(() => { void refreshHistory().catch(() => {}); }, 1000);
    }
  }, []);

  const stop = () => abortRef.current?.abort();

  // ── Render ─────────────────────────────────────────────────────
  if (view.kind === "loading_history") {
    return <div style={centerStyle}><Loader2 size={14} className="af-spin" /> Loading reports…<Spin /></div>;
  }

  if (view.kind === "error") {
    return (
      <div style={errorStyle}>
        <strong>Error:</strong> {view.message}
        <button type="button" onClick={() => { void refreshHistory(); }} style={{ ...primaryBtn, marginLeft: 12 }}>Back to reports</button>
      </div>
    );
  }

  if (view.kind === "report") {
    return (
      <div style={{ position: "relative" }}>
        <div style={topNavStyle} className="no-print">
          <button type="button" onClick={refreshHistory} style={secondaryBtn}>
            <ArrowLeft size={12} /> Reports
          </button>
          {view.key && (
            <span style={{ fontSize: 11, color: "var(--af-text-tertiary)", fontFamily: "var(--font-mono)" }}>
              saved · key: {view.key}
            </span>
          )}
        </div>
        <InsightReport data={view.report} savedKey={view.key} />
      </div>
    );
  }

  if (view.kind === "generating") {
    return <GeneratingView view={view} onStop={stop} />;
  }

  // history
  return (
    <HistoryView
      saved={view.saved}
      onGenerate={generate}
      onOpen={openSaved}
    />
  );
}

// ──────────────────────────────────────────────────────────────────
//                          HISTORY VIEW
// ──────────────────────────────────────────────────────────────────

function HistoryView({
  saved, onGenerate, onOpen,
}: {
  saved: SavedReportMeta[];
  onGenerate: (r: RangeChoice) => void;
  onOpen: (key: string) => void;
}) {
  const [tab, setTab] = useState<"weeks" | "months">("weeks");
  const [weeks, setWeeks] = useState<WeekRow[] | null>(null);
  const [includeInProgress, setIncludeInProgress] = useState(false);

  useEffect(() => {
    void fetch("/api/insights/weeks-index?count=12")
      .then((r) => r.json())
      .then((j: { weeks: WeekRow[] }) => setWeeks(j.weeks))
      .catch(() => setWeeks([]));
  }, []);

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: "32px 40px 64px", display: "flex", flexDirection: "column", gap: 24 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>Insights</h1>
        <p style={{ fontSize: 13, color: "var(--af-text-secondary)", margin: 0, lineHeight: 1.55 }}>
          Pick a calendar week or a 4-week rollup. If a report already exists we'll open it instantly; otherwise
          Claude runs the pipeline (~1–3 min) and saves the result locally.
        </p>
      </header>

      {/* Tabs */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={tabGroup}>
          {(["weeks", "months"] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)}
              style={{
                ...tabBtn,
                background: tab === t ? "var(--af-accent)" : "transparent",
                color: tab === t ? "white" : "var(--af-text-secondary)",
              }}>
              {t === "weeks" ? "Weeks" : "Months"}
            </button>
          ))}
        </div>
        {tab === "weeks" && (
          <label style={inProgressToggle}>
            <input type="checkbox" checked={includeInProgress} onChange={(e) => setIncludeInProgress(e.target.checked)} />
            <span>Include current week</span>
          </label>
        )}
      </div>

      {/* Weeks list or month rollup */}
      {tab === "weeks" ? (
        weeks === null ? (
          <div style={emptyHistoryStyle}>Loading weeks…</div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            {weeks
              .filter((w) => includeInProgress || !w.in_progress)
              .map((w) => (
                <WeekPickerRow
                  key={w.start}
                  w={w}
                  onView={() => w.saved_key && onOpen(w.saved_key)}
                  onGenerate={() => onGenerate({
                    id: `week-${w.start}`,
                    label: `Week of ${w.label}`,
                    body: { range_type: "custom", since: w.start, until: w.end },
                  })}
                />
              ))}
          </ul>
        )
      ) : (
        <MonthsView saved={saved} onGenerate={onGenerate} onOpen={onOpen} />
      )}
      <Spin />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
//                          PICKER ROWS
// ──────────────────────────────────────────────────────────────────

function WeekPickerRow({
  w, onView, onGenerate,
}: {
  w: WeekRow;
  onView: () => void;
  onGenerate: () => void;
}) {
  const saved = !!w.saved_key;
  const empty = w.sessions === 0 && !w.in_progress;
  return (
    <li style={pickerRow(saved)}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--af-text)", letterSpacing: "-0.01em" }}>
            W{String(w.iso_week).padStart(2, "0")} · {w.label}
          </span>
          {w.in_progress && <span style={inProgressTag}>in progress</span>}
        </div>
        <div style={{ fontSize: 11, color: "var(--af-text-tertiary)", fontFamily: "var(--font-mono)", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span>{w.sessions} sess</span>
          {saved && w.archetype_label && (
            <>
              <span>·</span>
              <span style={{ color: "var(--af-accent)" }}>{w.archetype_label}</span>
              <span>·</span>
              <span>{w.sessions_used} used · {w.prs} PR</span>
            </>
          )}
          {empty && <><span>·</span><span>no data</span></>}
        </div>
      </div>
      {saved ? (
        <button type="button" onClick={onView} style={primaryBtn}>
          View report <ChevronRight size={13} />
        </button>
      ) : empty ? (
        <span style={disabledCTA}>no data</span>
      ) : w.in_progress ? (
        <button type="button" onClick={onGenerate} style={secondaryBtn} title="Current week is partial and won't be auto-saved">
          Generate anyway
        </button>
      ) : (
        <button type="button" onClick={onGenerate} style={secondaryBtn}>
          Generate
        </button>
      )}
    </li>
  );
}

function MonthsView({
  saved, onGenerate, onOpen,
}: {
  saved: SavedReportMeta[];
  onGenerate: (r: RangeChoice) => void;
  onOpen: (key: string) => void;
}) {
  // MVP: one tile for the last-4-completed-weeks rollup. Presence flag if
  // a matching 4weeks-* key exists in saved.
  const prior = priorCalendarWeek();
  const start = new Date(prior.end); start.setDate(prior.end.getDate() - 27);
  const key = `4weeks-${isoDay(start)}`;
  const existing = saved.find((s) => s.key === key);
  const label = `${fmtDate(start)} – ${fmtDate(prior.end)}`;
  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
      <li style={pickerRow(!!existing)}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--af-text)" }}>
            Last 4 completed weeks
          </div>
          <div style={{ fontSize: 11, color: "var(--af-text-tertiary)", fontFamily: "var(--font-mono)" }}>
            {label} · 28-day rollup
            {existing && <> · <span style={{ color: "var(--af-accent)" }}>{existing.archetype_label}</span></>}
          </div>
        </div>
        {existing ? (
          <button type="button" onClick={() => onOpen(existing.key)} style={primaryBtn}>
            View report <ChevronRight size={13} />
          </button>
        ) : (
          <button type="button" style={secondaryBtn}
            onClick={() => onGenerate({
              id: key,
              label: `Last 4 completed weeks`,
              body: { range_type: "4weeks_completed" },
            })}>
            Generate
          </button>
        )}
      </li>
    </ul>
  );
}

// ──────────────────────────────────────────────────────────────────
//                         GENERATING VIEW
// ──────────────────────────────────────────────────────────────────

function GeneratingView({
  view, onStop,
}: {
  view: Extract<View, { kind: "generating" }>;
  onStop: () => void;
}) {
  const elapsedS = Math.floor(view.elapsedMs / 1000);
  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: "60px 40px", display: "flex", flexDirection: "column", gap: 24 }}>
      <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--af-text-tertiary)", fontWeight: 600 }}>
            Generating
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", margin: "2px 0 0" }}>{view.label}</h1>
        </div>
        <button type="button" onClick={onStop} style={secondaryBtn}>
          <Square size={12} /> Stop
        </button>
      </header>

      {/* Phase summary strip */}
      <div style={phaseStripStyle}>
        {view.phases.map((p, i) => (
          <div key={p.id} style={phaseChipStyle(p.status)}>
            <PhaseIcon status={p.status} />
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.02em" }}>
              {i + 1}. {p.label}
            </span>
          </div>
        ))}
        <div style={{ marginLeft: "auto", fontSize: 11, color: "var(--af-text-tertiary)", fontFamily: "var(--font-mono)", display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Loader2 size={11} className="af-spin" /> {elapsedS}s elapsed
        </div>
      </div>

      {/* Active phase detail */}
      {view.phases.map((p) => p.steps.length > 0 ? (
        <div key={p.id} style={phaseDetailStyle(p.status)}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <PhaseIcon status={p.status} />
            <span style={{ fontSize: 12, fontWeight: 600, color: p.status === "done" ? "var(--af-text-secondary)" : "var(--af-text)" }}>
              {p.label}
            </span>
          </div>
          <ol style={stepsListStyle}>
            {p.steps.map((s, i) => (
              <li key={i} style={{
                ...stepItemStyle,
                opacity: i === p.steps.length - 1 && p.status === "running" ? 1 : 0.65,
              }}>
                <span style={{ color: "var(--af-accent)", fontSize: 10, width: 10 }}>
                  {i === p.steps.length - 1 && p.status === "running" ? "•" : "✓"}
                </span>
                {s}
              </li>
            ))}
          </ol>
        </div>
      ) : null)}

      <Spin />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
//                            Helpers
// ──────────────────────────────────────────────────────────────────

function phaseOrder(p: PhaseId): number {
  return { data: 0, analyst: 1, compose: 2 }[p];
}

function isSupersedingUpdate(prev: string, next: string): boolean {
  // e.g. "Built 7/26 capsules" → "Built 14/26 capsules" supersedes
  // "Claude composing… 500 chars" → "Claude composing… 1500 chars" supersedes
  const prefixes = ["Built ", "Claude composing", "Aggregating ", "Sending "];
  return prefixes.some((p) => prev.startsWith(p) && next.startsWith(p));
}

function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ──────────────────────────────────────────────────────────────────
//                         Sub-components
// ──────────────────────────────────────────────────────────────────

function PhaseIcon({ status }: { status: Phase["status"] }) {
  if (status === "done") return <CheckCircle2 size={14} color="var(--af-accent)" />;
  if (status === "running") return <Loader2 size={14} color="var(--af-accent)" className="af-spin" />;
  return <Circle size={14} color="var(--af-text-tertiary)" />;
}

function Spin() {
  return (
    <style>{`
      @keyframes af-spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
      .af-spin { animation: af-spin 0.9s linear infinite; }
    `}</style>
  );
}

// ──────────────────────────────────────────────────────────────────
//                              Styles
// ──────────────────────────────────────────────────────────────────

const centerStyle: React.CSSProperties = {
  padding: "80px 40px", textAlign: "center",
  fontSize: 13, color: "var(--af-text-secondary)",
  display: "inline-flex", alignItems: "center", gap: 8, justifyContent: "center", width: "100%",
};

const errorStyle: React.CSSProperties = {
  maxWidth: 720, margin: "60px auto", padding: "14px 18px", borderRadius: 10,
  border: "1px solid var(--af-border)", background: "var(--af-surface)",
  fontSize: 13, color: "var(--af-text)",
};

const primaryBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px",
  border: "1px solid var(--af-accent)", borderRadius: 8,
  background: "var(--af-accent)", color: "white",
  fontSize: 12, fontWeight: 600, cursor: "pointer",
};

const secondaryBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 12px",
  border: "1px solid var(--af-border)", borderRadius: 8,
  background: "var(--af-surface)", color: "var(--af-text)",
  fontSize: 12, fontWeight: 500, cursor: "pointer",
};

const tabGroup: React.CSSProperties = {
  display: "inline-flex", gap: 3, border: "1px solid var(--af-border)", borderRadius: 8, padding: 2,
};

const tabBtn: React.CSSProperties = {
  padding: "5px 14px", fontSize: 12, fontWeight: 600,
  border: "none", borderRadius: 6, cursor: "pointer",
};

const inProgressToggle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6,
  fontSize: 11.5, color: "var(--af-text-secondary)",
  cursor: "pointer", marginLeft: "auto",
};

function pickerRow(saved: boolean): React.CSSProperties {
  return {
    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14,
    padding: "12px 16px", borderRadius: 10,
    border: `1px solid ${saved ? "color-mix(in srgb, var(--af-accent) 24%, var(--af-border))" : "var(--af-border-subtle)"}`,
    background: saved ? "color-mix(in srgb, var(--af-accent) 6%, var(--af-surface))" : "var(--af-surface)",
  };
}

const disabledCTA: React.CSSProperties = {
  fontSize: 11.5, color: "var(--af-text-tertiary)", fontFamily: "var(--font-mono)",
  padding: "7px 12px",
};

const topNavStyle: React.CSSProperties = {
  maxWidth: 980, margin: "0 auto", padding: "16px 44px 0",
  display: "flex", alignItems: "center", gap: 12,
};

const inProgressTag: React.CSSProperties = {
  fontSize: 10, fontWeight: 500, padding: "2px 6px", borderRadius: 4,
  background: "color-mix(in srgb, #f5b445 18%, transparent)", color: "#c08a1f",
  marginLeft: 8, letterSpacing: "0.02em",
};

const emptyHistoryStyle: React.CSSProperties = {
  padding: "20px 18px", borderRadius: 10,
  border: "1px dashed var(--af-border)", background: "var(--af-surface)",
  fontSize: 12.5, color: "var(--af-text-tertiary)", lineHeight: 1.55,
};

const phaseStripStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
  padding: "10px 14px", borderRadius: 10,
  border: "1px solid var(--af-border-subtle)", background: "var(--af-surface)",
};

function phaseChipStyle(status: Phase["status"]): React.CSSProperties {
  return {
    display: "inline-flex", alignItems: "center", gap: 6,
    padding: "4px 10px", borderRadius: 999,
    background: status === "running"
      ? "color-mix(in srgb, var(--af-accent) 16%, transparent)"
      : status === "done"
        ? "color-mix(in srgb, var(--af-accent) 9%, transparent)"
        : "var(--af-surface-raised)",
    color: status === "pending" ? "var(--af-text-tertiary)" : "var(--af-text)",
  };
}

function phaseDetailStyle(status: Phase["status"]): React.CSSProperties {
  return {
    padding: "14px 18px", borderRadius: 10,
    border: "1px solid var(--af-border-subtle)",
    background: status === "running" ? "var(--af-surface)" : "transparent",
    opacity: status === "pending" ? 0.6 : 1,
  };
}

const stepsListStyle: React.CSSProperties = {
  listStyle: "none", padding: 0, margin: 0,
  display: "flex", flexDirection: "column", gap: 4,
  fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--af-text-secondary)",
};

const stepItemStyle: React.CSSProperties = {
  display: "flex", alignItems: "baseline", gap: 8,
};
