"use client";
import { useState, useCallback } from "react";
import { DayDigest as DayDigestRender } from "./day-digest";
import type { DayDigest as DayDigestType } from "@claude-lens/entries";

type Status = "idle" | "streaming" | "done" | "error";

export function DayDigestView({
  initial, date, aiEnabled,
}: {
  initial: DayDigestType | null;
  date: string;
  aiEnabled: boolean;
}) {
  const [digest, setDigest] = useState<DayDigestType | null>(initial);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState<string>("");

  const regenerate = useCallback(async (force = false) => {
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
          else if (ev.type === "entry") setProgress(`Enriching ${ev.index}/${ev.total}...`);
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

  return (
    <>
      <div style={{ display: "flex", gap: 10, padding: "14px 40px 0", alignItems: "center" }}>
        <button
          onClick={() => regenerate(true)}
          disabled={isStreaming}
          style={{
            padding: "6px 12px",
            border: "1px solid var(--af-border-subtle)",
            borderRadius: 6,
            background: "transparent",
            cursor: isStreaming ? "default" : "pointer",
            fontSize: 12,
            opacity: isStreaming ? 0.6 : 1,
          }}>
          🔄 {isStreaming ? "Regenerating..." : "Regenerate"}
        </button>
        {progress && <span style={{ fontSize: 11, color: "var(--af-text-tertiary)" }}>{progress}</span>}
      </div>

      {digest ? (
        <DayDigestRender digest={digest} aiEnabled={aiEnabled} />
      ) : (
        <div style={{ padding: 40, textAlign: "center", color: "var(--af-text-secondary)" }}>
          <p>No digest generated yet.</p>
          <button onClick={() => regenerate(false)} disabled={isStreaming}
            style={{
              padding: "8px 16px",
              marginTop: 10,
              background: "var(--af-accent)",
              color: "white",
              border: "none",
              borderRadius: 6,
              cursor: isStreaming ? "default" : "pointer",
              opacity: isStreaming ? 0.6 : 1,
            }}>
            {isStreaming ? "Generating..." : "Generate digest"}
          </button>
        </div>
      )}
    </>
  );
}
