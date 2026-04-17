"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Square, Zap } from "lucide-react";
import { InsightReport, type ReportData } from "@/components/insight-report";

type RunState =
  | { kind: "idle" }
  | { kind: "running"; steps: string[] }
  | { kind: "done"; report: ReportData }
  | { kind: "error"; message: string };

type Range = "week" | "4weeks";

export function InsightsView() {
  const [range, setRange] = useState<Range>("week");
  const [state, setState] = useState<RunState>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(
    async (chosen: Range) => {
      if (state.kind === "running") return;
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const steps: string[] = [];
      setState({ kind: "running", steps });

      try {
        const res = await fetch("/api/insights", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ range_type: chosen }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          setState({ kind: "error", message: await res.text() || `HTTP ${res.status}` });
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let lastStep = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop()!;
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const json = line.slice(6).trim();
            if (!json) continue;
            try {
              const data = JSON.parse(json) as {
                type: string; text?: string; report?: ReportData; message?: string;
              };
              if (data.type === "status" && data.text && data.text !== lastStep) {
                lastStep = data.text;
                steps.push(data.text);
                setState({ kind: "running", steps: [...steps] });
              } else if (data.type === "report" && data.report) {
                setState({ kind: "done", report: data.report });
              } else if (data.type === "error") {
                setState({ kind: "error", message: data.message ?? "unknown error" });
                return;
              }
            } catch { /* skip malformed */ }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setState({ kind: "error", message: (err as Error).message });
        }
      } finally {
        abortRef.current = null;
      }
    },
    [state.kind],
  );

  const stop = () => abortRef.current?.abort();

  // Auto-run once on first mount if idle
  useEffect(() => {
    if (state.kind === "idle") void start(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state.kind === "done") {
    return <InsightReport data={state.report} />;
  }

  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 20,
      maxWidth: 760, margin: "0 auto", padding: "60px 40px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={rangeGroup}>
          {(["week", "4weeks"] as Range[]).map((r) => (
            <button
              key={r}
              type="button"
              disabled={state.kind === "running"}
              onClick={() => setRange(r)}
              style={{
                ...rangeBtn,
                background: range === r ? "var(--af-accent)" : "transparent",
                color: range === r ? "white" : "var(--af-text-secondary)",
              }}
            >
              {r === "week" ? "This week" : "Last 4 weeks"}
            </button>
          ))}
        </div>
        {state.kind === "running" ? (
          <button type="button" onClick={stop} style={secondaryBtn}>
            <Square size={12} /> Stop
          </button>
        ) : (
          <button type="button" onClick={() => start(range)} style={primaryBtn}>
            <Zap size={12} /> Generate
          </button>
        )}
      </div>

      {state.kind === "running" && (
        <div style={stepsPanel}>
          <div style={stepsHeader}>
            <Loader2 size={13} className="af-spin" /> Running insights pipeline
          </div>
          <ol style={stepsList}>
            {state.steps.map((s, i) => (
              <li key={i} style={{
                ...stepItem,
                opacity: i === state.steps.length - 1 ? 1 : 0.55,
                fontWeight: i === state.steps.length - 1 ? 500 : 400,
              }}>
                <span style={stepDot}>{i === state.steps.length - 1 ? "•" : "✓"}</span>
                {s}
              </li>
            ))}
          </ol>
        </div>
      )}

      {state.kind === "error" && (
        <div style={errorPanel}>
          <strong>Error:</strong> {state.message}
        </div>
      )}

      {state.kind === "idle" && (
        <div style={{ fontSize: 13, color: "var(--af-text-tertiary)", textAlign: "center" }}>
          Pick a range and press Generate. Claude reads per-session capsules and composes a structured report.
        </div>
      )}

      <style>{`
        @keyframes af-spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
        .af-spin { animation: af-spin 0.9s linear infinite; }
      `}</style>
    </div>
  );
}

const rangeGroup: React.CSSProperties = {
  display: "inline-flex", gap: 4,
  border: "1px solid var(--af-border)", borderRadius: 8, padding: 2,
};

const rangeBtn: React.CSSProperties = {
  padding: "6px 14px", fontSize: 12, fontWeight: 600,
  border: "none", borderRadius: 6, cursor: "pointer",
};

const primaryBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "7px 14px", border: "1px solid var(--af-accent)", borderRadius: 8,
  background: "var(--af-accent)", color: "white",
  fontSize: 12, fontWeight: 600, cursor: "pointer",
  marginLeft: "auto",
};

const secondaryBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6,
  padding: "7px 14px", border: "1px solid var(--af-border)", borderRadius: 8,
  background: "var(--af-surface)", color: "var(--af-text)",
  fontSize: 12, fontWeight: 500, cursor: "pointer",
  marginLeft: "auto",
};

const stepsPanel: React.CSSProperties = {
  background: "var(--af-surface)",
  border: "1px solid var(--af-border-subtle)",
  borderRadius: 12, padding: "18px 22px",
};

const stepsHeader: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8,
  fontSize: 12, color: "var(--af-text-secondary)",
  marginBottom: 14, fontWeight: 600,
};

const stepsList: React.CSSProperties = {
  listStyle: "none", padding: 0, margin: 0,
  display: "flex", flexDirection: "column", gap: 6,
  fontFamily: "var(--font-mono)", fontSize: 12,
  color: "var(--af-text)",
};

const stepItem: React.CSSProperties = {
  display: "flex", alignItems: "baseline", gap: 8,
};

const stepDot: React.CSSProperties = {
  color: "var(--af-accent)", fontSize: 14, width: 10,
};

const errorPanel: React.CSSProperties = {
  padding: 14, borderRadius: 10,
  border: "1px solid var(--af-border)",
  background: "var(--af-surface)",
  fontSize: 12, color: "var(--af-danger, #c13f33)",
};
