"use client";
import { useState, useCallback, useMemo, type ReactNode } from "react";
import { DayDigest as DayDigestRender } from "./day-digest";
import type { DayDigest as DayDigestType, Entry } from "@claude-lens/entries";

type Status = "idle" | "streaming" | "done" | "error";

export function DayDigestView({
  initial, entries, date, aiEnabled,
}: {
  initial: DayDigestType | null;
  entries: Entry[];
  date: string;
  aiEnabled: boolean;
}) {
  const [digest, setDigest] = useState<DayDigestType | null>(initial);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState<string>("");

  const generate = useCallback(async (force = false) => {
    setStatus("streaming");
    setProgress("Starting...");
    const url = `/api/digest/day/${date}${force ? "?force=1" : ""}`;
    const res = await fetch(url, { method: "POST" });
    if (!res.ok || !res.body) {
      setStatus("error");
      setProgress(`Error ${res.status}`);
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n\n");
      buf = lines.pop() ?? "";
      for (const frame of lines) {
        const dataLine = frame.split("\n").find(l => l.startsWith("data: "));
        if (!dataLine) continue;
        try {
          const ev = JSON.parse(dataLine.slice(6));
          if (ev.type === "status") setProgress(ev.text);
          else if (ev.type === "entry") setProgress(`Enriching ${ev.index}/${ev.total}${ev.cost_usd ? ` · $${ev.cost_usd.toFixed(4)}` : ""}...`);
          else if (ev.type === "progress") {
            const sec = Math.round(ev.elapsed_ms / 1000);
            const kb = (ev.bytes / 1024).toFixed(1);
            setProgress(`Claude composing… ${ev.bytes.toLocaleString()} chars (${kb} KB · ${sec}s)`);
          }
          else if (ev.type === "digest") { setDigest(ev.digest); setProgress("Rendering..."); }
          else if (ev.type === "saved") setProgress(`Saved.`);
          else if (ev.type === "error") { setStatus("error"); setProgress(ev.message); return; }
        } catch { /* skip */ }
      }
    }
    setStatus("done");
    setProgress("");
  }, [date]);

  const isStreaming = status === "streaming";

  // A digest with a headline means synthesis ran — trust that as "fresh"
  // even when a few entries are stuck in `pending` (e.g. rate-limited
  // retries that didn't increment retry_count). Otherwise stuck entries
  // would trap the user clicking "Generate" forever, since the pipeline
  // short-circuits to the cached digest without re-enriching anyway.
  // Users who want to recover stuck entries can use Re-roll narrative
  // (which forces a fresh pipeline run that retries the pending capsules).
  const narrativeIsFresh = !!digest?.headline;
  const allTrivial = useMemo(() => {
    if (entries.length === 0) return false;
    return entries.every((e) => e.enrichment.status === "skipped_trivial");
  }, [entries]);
  const isEmpty = entries.length === 0;
  const hasMissingWork = !isEmpty && !allTrivial && !narrativeIsFresh;

  // Build the actions slot for the digest hero meta-row. Returns null
  // when there's nothing actionable (empty / all-trivial days).
  let actions: ReactNode = null;
  if (!isEmpty && !allTrivial) {
    if (hasMissingWork) {
      actions = (
        <button
          onClick={() => generate(false)}
          disabled={isStreaming}
          style={{
            padding: "4px 10px",
            background: "var(--af-accent)",
            color: "white",
            border: "none",
            borderRadius: 5,
            cursor: isStreaming ? "default" : "pointer",
            fontSize: 11,
            fontWeight: 600,
            opacity: isStreaming ? 0.6 : 1,
          }}
        >
          {isStreaming ? "Generating..." : digest ? "Generate (catch up)" : "Generate digest"}
        </button>
      );
    } else {
      actions = (
        <span
          style={{
            fontSize: 10,
            color: "var(--af-text-tertiary)",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          ✓ Up to date
          <button
            onClick={() => generate(true)}
            disabled={isStreaming}
            title="Re-roll the narrative without re-enriching capsules"
            style={{
              padding: "2px 7px",
              background: "transparent",
              border: "1px solid var(--af-border-subtle)",
              borderRadius: 4,
              fontSize: 10,
              color: "var(--af-text-secondary)",
              cursor: isStreaming ? "default" : "pointer",
              opacity: isStreaming ? 0.6 : 1,
            }}
          >
            {isStreaming ? "..." : "Re-roll"}
          </button>
        </span>
      );
    }
    if (progress) {
      actions = (
        <>
          {actions}
          <span style={{ fontSize: 10, color: "var(--af-text-tertiary)" }}>{progress}</span>
        </>
      );
    }
  }

  if (digest) {
    return <DayDigestRender digest={digest} entries={entries} aiEnabled={aiEnabled} actions={actions} />;
  }

  // No digest yet — render a slim row with whatever action applies, then
  // a one-line empty-state hint.
  return (
    <>
      {actions && (
        <div
          style={{
            display: "flex",
            gap: 10,
            padding: "14px 40px 0",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          {actions}
        </div>
      )}
      {isEmpty ? (
        <div style={{ padding: 28, textAlign: "center", color: "var(--af-text-tertiary)", fontSize: 13 }}>
          No entries on this day.
        </div>
      ) : allTrivial ? (
        <div style={{ padding: 28, textAlign: "center", color: "var(--af-text-tertiary)", fontSize: 13 }}>
          💤 Warm-up only — every session was under a minute. No narrative needed.
        </div>
      ) : (
        <div style={{ padding: 28, textAlign: "center", color: "var(--af-text-secondary)", fontSize: 13 }}>
          No digest generated yet — click Generate above.
        </div>
      )}
    </>
  );
}
