"use client";

import React, { useCallback, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Lightbulb, Loader2, Square } from "lucide-react";

type Range = "7d" | "30d" | "90d";

type RunState =
  | { kind: "idle" }
  | { kind: "running"; status: string; narrative: string }
  | { kind: "done"; status: string; narrative: string; capsuleCount: number; promptTokens?: number }
  | { kind: "error"; narrative: string; message: string };

export function InsightsView() {
  const [range, setRange] = useState<Range>("7d");
  const [state, setState] = useState<RunState>({ kind: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  const start = useCallback(
    async (chosenRange: Range) => {
      if (state.kind === "running") return;
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setState({ kind: "running", status: "Starting…", narrative: "" });

      let narrative = "";
      let status = "Starting…";
      let capsuleCount = 0;
      let promptTokens: number | undefined;

      try {
        const res = await fetch("/api/insights", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ range: chosenRange, mode: "compact" }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          setState({ kind: "error", narrative: "", message: (await res.text()) || `HTTP ${res.status}` });
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
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
                type: string; text?: string; message?: string;
                capsuleCount?: number; promptTokens?: number;
              };
              if (data.type === "status" && data.text) {
                status = data.text;
                setState({ kind: "running", status, narrative });
              } else if (data.type === "delta" && data.text) {
                narrative += data.text;
                setState({ kind: "running", status, narrative });
              } else if (data.type === "done") {
                capsuleCount = data.capsuleCount ?? 0;
                promptTokens = data.promptTokens;
                setState({ kind: "done", status, narrative, capsuleCount, promptTokens });
              } else if (data.type === "error") {
                setState({ kind: "error", narrative, message: data.message ?? "unknown error" });
                return;
              }
            } catch {
              // skip
            }
          }
        }
        // If stream closed without a done event, treat trailing state as done.
        if (narrative) {
          setState((prev) =>
            prev.kind === "done" ? prev : { kind: "done", status, narrative, capsuleCount, promptTokens },
          );
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setState({ kind: "error", narrative, message: (err as Error).message });
        }
      } finally {
        abortRef.current = null;
      }
    },
    [state.kind],
  );

  const stop = () => {
    abortRef.current?.abort();
    setState((prev) =>
      prev.kind === "running"
        ? { kind: "error", narrative: prev.narrative, message: "Stopped by user" }
        : prev,
    );
  };

  const running = state.kind === "running";
  const narrative =
    state.kind === "running" || state.kind === "done" || state.kind === "error"
      ? state.narrative
      : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            color: "var(--af-text-secondary)",
            marginRight: "auto",
          }}
        >
          <Lightbulb size={14} color="var(--af-accent)" />
          <span>Range</span>
        </div>
        <div style={{ display: "inline-flex", gap: 4, border: "1px solid var(--af-border)", borderRadius: 8, padding: 2 }}>
          {(["7d", "30d", "90d"] as Range[]).map((r) => (
            <button
              key={r}
              type="button"
              disabled={running}
              onClick={() => setRange(r)}
              style={{
                padding: "5px 12px",
                fontSize: 12,
                fontWeight: 600,
                background: range === r ? "var(--af-accent)" : "transparent",
                color: range === r ? "white" : "var(--af-text-secondary)",
                border: "none",
                borderRadius: 6,
                cursor: running ? "not-allowed" : "pointer",
                opacity: running ? 0.5 : 1,
              }}
            >
              {r}
            </button>
          ))}
        </div>
        {running ? (
          <button
            type="button"
            onClick={stop}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 14px",
              border: "1px solid var(--af-border)",
              borderRadius: 7,
              background: "var(--af-surface)",
              color: "var(--af-text)",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <Square size={12} /> Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={() => start(range)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 14px",
              border: "1px solid var(--af-accent)",
              borderRadius: 7,
              background: "var(--af-accent)",
              color: "white",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Generate insights
          </button>
        )}
      </div>

      {state.kind === "running" && (
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
            color: "var(--af-text-secondary)",
          }}
        >
          <Loader2 size={13} className="af-spin" />
          {state.status}
        </div>
      )}
      {state.kind === "done" && (
        <div style={{ fontSize: 11, color: "var(--af-text-tertiary)", fontFamily: "var(--font-mono)" }}>
          {state.capsuleCount} capsules
          {state.promptTokens !== undefined ? ` · ${state.promptTokens.toLocaleString()} prompt tokens` : ""}
        </div>
      )}
      {state.kind === "error" && (
        <div style={{ fontSize: 12, color: "var(--af-danger)", background: "var(--af-surface)", padding: 12, borderRadius: 8, border: "1px solid var(--af-border)" }}>
          <strong>Error:</strong> {state.message}
        </div>
      )}

      {narrative && (
        <div
          className="af-panel"
          style={{ padding: "24px 28px", fontSize: 14, lineHeight: 1.65, color: "var(--af-text)" }}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{narrative}</ReactMarkdown>
        </div>
      )}

      {state.kind === "idle" && (
        <div
          className="af-empty"
          style={{ padding: "40px 20px", textAlign: "center", fontSize: 13, color: "var(--af-text-tertiary)" }}
        >
          Pick a time range and press <strong>Generate insights</strong>. Claude will read a compact per-session summary of that window and write you a narrative retrospective.
        </div>
      )}

      <style>{`
        @keyframes af-spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
        .af-spin { animation: af-spin 0.9s linear infinite; }
      `}</style>
    </div>
  );
}
