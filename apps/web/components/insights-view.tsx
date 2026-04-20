"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, Calendar, CheckCircle2, ChevronRight,
  Circle, FileClock, Loader2, Square, Zap,
} from "lucide-react";
import { calendarWeek, priorCalendarWeek } from "@claude-lens/parser";
import { InsightReport, type ReportData } from "@/components/insight-report";
import type { SavedReportMeta } from "@/lib/ai/saved-reports";

type RangeId = "prior_week" | "4weeks_completed" | "week";
type RangeChoice = { id: RangeId; label: string; period: string; note: string };

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
  | { kind: "generating"; rangeId: RangeId; label: string; phases: Phase[]; elapsedMs: number }
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

  const ranges: RangeChoice[] = useMemo(() => buildRangeChoices(), []);
  const defaultRange = ranges[0]!; // prior_week

  // Load saved reports on mount
  useEffect(() => {
    void refreshHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        body: JSON.stringify({ range_type: range.id }),
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
        <button type="button" onClick={refreshHistory} style={{ ...primaryBtn, marginLeft: 12 }}>Back to reports</button>
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
        <InsightReport data={view.report} />
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
      ranges={ranges}
      defaultRange={defaultRange}
      onGenerate={generate}
      onOpen={openSaved}
    />
  );
}

// ──────────────────────────────────────────────────────────────────
//                          HISTORY VIEW
// ──────────────────────────────────────────────────────────────────

function HistoryView({
  saved, ranges, defaultRange, onGenerate, onOpen,
}: {
  saved: SavedReportMeta[];
  ranges: RangeChoice[];
  defaultRange: RangeChoice;
  onGenerate: (r: RangeChoice) => void;
  onOpen: (key: string) => void;
}) {
  const priorKey = `week-${isoDay(priorWeekStart())}`;
  const priorSaved = saved.find((s) => s.key === priorKey);

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: "32px 40px 64px", display: "flex", flexDirection: "column", gap: 28 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", margin: 0 }}>Insights</h1>
        <p style={{ fontSize: 13, color: "var(--af-text-secondary)", margin: 0, lineHeight: 1.55 }}>
          Narrative retrospectives generated by a local Claude subprocess. Reports run on completed calendar weeks —
          capsules, aggregates, concurrency, plan utilization → narrative. Once generated, reports save locally so you can revisit without re-running.
        </p>
      </header>

      {/* Primary CTA — view the saved one if it exists, otherwise generate */}
      <div style={ctaPanelStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={ctaIconWrap}><Calendar size={16} color="var(--af-accent)" /></div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <div style={ctaEyebrow}>{priorSaved ? "Last week" : "Recommended"}</div>
            <div style={ctaTitle}>{defaultRange.label}</div>
            <div style={ctaPeriod}>
              {defaultRange.period}
              {priorSaved
                ? ` · saved ${timeAgo(priorSaved.saved_at)} · ${priorSaved.archetype_label}`
                : ` · ${defaultRange.note}`}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto", flexShrink: 0 }}>
            {priorSaved && (
              <button type="button" onClick={() => onGenerate(defaultRange)} style={ghostBtn} title="Discard saved report and re-run the pipeline">
                <Zap size={11} /> Regenerate
              </button>
            )}
            <button
              type="button"
              onClick={() => priorSaved ? onOpen(priorSaved.key) : onGenerate(defaultRange)}
              style={primaryBtn}
            >
              {priorSaved ? <>View report <ChevronRight size={13} /></> : <><Zap size={13} /> Generate</>}
            </button>
          </div>
        </div>
      </div>

      {/* Alt ranges */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={miniSectionTitle}>Other windows</div>
        {ranges.slice(1).map((r) => {
          const already = r.id === "prior_week" && !!priorSaved;
          const inProgress = r.id === "week";
          return (
            <div key={r.id} style={altRangeRow}>
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <div style={{ fontSize: 13, color: "var(--af-text)", fontWeight: 500 }}>
                  {r.label}
                  {inProgress && <span style={inProgressTag}>in progress</span>}
                </div>
                <div style={{ fontSize: 11, color: "var(--af-text-tertiary)", fontFamily: "var(--font-mono)" }}>
                  {r.period}{r.note ? ` · ${r.note}` : ""}
                </div>
              </div>
              <button type="button" onClick={() => onGenerate(r)} style={secondaryBtn}>
                <Zap size={11} /> {already ? "Regenerate" : "Generate"}
              </button>
            </div>
          );
        })}
      </div>

      {/* Saved history */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={miniSectionTitle}><FileClock size={12} style={{ verticalAlign: -1, marginRight: 6 }} />Saved reports</div>
          <div style={{ fontSize: 11, color: "var(--af-text-tertiary)", fontFamily: "var(--font-mono)" }}>{saved.length}</div>
        </div>
        {saved.length === 0 ? (
          <div style={emptyHistoryStyle}>
            No reports yet. Generate one above — we'll save it so you can come back to it without re-running the pipeline.
          </div>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {saved.map((s) => (
              <li key={s.key}>
                <button type="button" onClick={() => onOpen(s.key)} style={savedRowStyle}>
                  <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--af-text)", letterSpacing: "-0.01em" }}>
                        {s.period_label}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--af-text-secondary)", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                        <span style={{ color: "var(--af-accent)", fontWeight: 500 }}>{s.archetype_label}</span>
                        <span style={{ color: "var(--af-text-tertiary)" }}>·</span>
                        <span style={{ color: "var(--af-text-tertiary)", fontFamily: "var(--font-mono)" }}>
                          {s.sessions_used} sess · {s.prs} PR · saved {timeAgo(s.saved_at)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <ChevronRight size={14} color="var(--af-text-tertiary)" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Spin />
    </div>
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

function buildRangeChoices(): RangeChoice[] {
  const prior = priorCalendarWeek();
  const last4Start = new Date(prior.end); last4Start.setDate(prior.end.getDate() - 27);
  const cur = calendarWeek();
  return [
    { id: "prior_week", label: "Last completed week",
      period: `${fmtDate(prior.start)} — ${fmtDate(prior.end)}`, note: "Mon–Sun · finished" },
    { id: "4weeks_completed", label: "Last 4 completed weeks",
      period: `${fmtDate(last4Start)} — ${fmtDate(prior.end)}`, note: "28-day rollup" },
    { id: "week", label: "Current week",
      period: `${fmtDate(cur.start)} — ${fmtDate(cur.end)}`, note: "won't be auto-saved" },
  ];
}

function priorWeekStart(): Date {
  return priorCalendarWeek().start;
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

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
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

const ghostBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 5, padding: "6px 10px",
  border: "1px solid transparent", borderRadius: 7,
  background: "transparent", color: "var(--af-text-secondary)",
  fontSize: 11.5, fontWeight: 500, cursor: "pointer",
};

const topNavStyle: React.CSSProperties = {
  maxWidth: 980, margin: "0 auto", padding: "16px 44px 0",
  display: "flex", alignItems: "center", gap: 12,
};

const ctaPanelStyle: React.CSSProperties = {
  padding: "20px 24px", borderRadius: 14,
  background: "linear-gradient(135deg, color-mix(in srgb, var(--af-accent) 10%, var(--af-surface)) 0%, var(--af-surface) 70%)",
  border: "1px solid color-mix(in srgb, var(--af-accent) 25%, var(--af-border))",
};

const ctaIconWrap: React.CSSProperties = {
  width: 38, height: 38, borderRadius: 10,
  background: "color-mix(in srgb, var(--af-accent) 16%, transparent)",
  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
};

const ctaEyebrow: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em",
  textTransform: "uppercase", color: "var(--af-accent)",
};

const ctaTitle: React.CSSProperties = {
  fontSize: 16, fontWeight: 600, color: "var(--af-text)", letterSpacing: "-0.01em",
};

const ctaPeriod: React.CSSProperties = {
  fontSize: 11, color: "var(--af-text-tertiary)", fontFamily: "var(--font-mono)", marginTop: 2,
};

const miniSectionTitle: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, letterSpacing: "0.06em",
  textTransform: "uppercase", color: "var(--af-text-tertiary)",
};

const altRangeRow: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
  padding: "12px 16px", borderRadius: 10,
  border: "1px solid var(--af-border-subtle)", background: "var(--af-surface)",
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

const savedRowStyle: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  width: "100%", padding: "11px 14px", borderRadius: 10,
  border: "1px solid var(--af-border-subtle)", background: "var(--af-surface)",
  color: "var(--af-text)", cursor: "pointer", textAlign: "left",
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
