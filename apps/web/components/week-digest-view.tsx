"use client";
import { useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import { WeekDigest as WeekDigestRender } from "./week-digest";
import type { WeekDigest as WeekDigestType } from "@claude-lens/entries";

type Status = "idle" | "streaming" | "done" | "error";

export function WeekDigestView({
  initial, monday, aiEnabled, autoFire = false,
}: {
  initial: WeekDigestType | null;
  monday: string;
  aiEnabled: boolean;
  autoFire?: boolean;
}) {
  const [digest, setDigest] = useState<WeekDigestType | null>(initial);
  const [status, setStatus] = useState<Status>("idle");
  const [progress, setProgress] = useState<string>("");
  const firedRef = useRef(false);

  const generate = useCallback(async (force = false) => {
    setStatus("streaming");
    setProgress("Starting...");
    const url = `/api/digest/week/${monday}${force ? "?force=1" : ""}`;
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
      const frames = buf.split("\n\n");
      buf = frames.pop() ?? "";
      for (const frame of frames) {
        const dataLine = frame.split("\n").find(l => l.startsWith("data: "));
        if (!dataLine) continue;
        try {
          const ev = JSON.parse(dataLine.slice(6));
          if (ev.type === "status") setProgress(ev.text);
          else if (ev.type === "dependency") {
            setProgress(`${ev.kind === "day" ? "Day" : "Week"} ${ev.key} ${ev.status}`);
          }
          else if (ev.type === "entry") setProgress(`Enriching ${ev.index}/${ev.total}...`);
          else if (ev.type === "progress") {
            const sec = Math.round(ev.elapsed_ms / 1000);
            setProgress(`Claude composing… ${ev.bytes.toLocaleString()} chars (${sec}s)`);
          }
          else if (ev.type === "digest") {
            if (ev.digest && ev.digest.scope === "week") {
              setDigest(ev.digest as WeekDigestType);
            }
            setProgress("Rendering...");
          }
          else if (ev.type === "saved") setProgress("Saved.");
          else if (ev.type === "error") { setStatus("error"); setProgress(ev.message); return; }
        } catch { /* skip */ }
      }
    }
    setStatus("done");
    setProgress("");
  }, [monday]);

  useEffect(() => {
    if (autoFire && !firedRef.current && status === "idle") {
      firedRef.current = true;
      void generate(false);
    }
  }, [autoFire, status, generate]);

  const isStreaming = status === "streaming";
  const narrativeFresh = !!digest?.headline;

  let actions: ReactNode = null;
  if (!narrativeFresh && aiEnabled) {
    actions = (
      <button
        onClick={() => generate(false)}
        disabled={isStreaming}
        style={btnPrimary(isStreaming)}
      >
        {isStreaming ? "Generating..." : digest ? "Generate" : "Generate digest"}
      </button>
    );
  } else if (aiEnabled) {
    actions = (
      <span style={{ fontSize: 10, color: "var(--af-text-tertiary)", display: "inline-flex", gap: 6, alignItems: "center" }}>
        ✓ Up to date
        <button
          onClick={() => generate(true)}
          disabled={isStreaming}
          title="Re-roll the narrative for this week"
          style={btnSecondary(isStreaming)}
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

  if (digest) {
    return <WeekDigestRender digest={digest} aiEnabled={aiEnabled} actions={actions} />;
  }
  return (
    <>
      {actions && (
        <div style={{ display: "flex", gap: 10, padding: "14px 40px 0", alignItems: "center", flexWrap: "wrap" }}>
          {actions}
        </div>
      )}
      <div style={{ padding: 28, textAlign: "center", color: "var(--af-text-secondary)", fontSize: 13 }}>
        {isStreaming ? "Loading week digest…" : "No digest yet — click Generate above."}
      </div>
    </>
  );
}

function btnPrimary(disabled: boolean): React.CSSProperties {
  return {
    padding: "4px 10px",
    background: "var(--af-accent)",
    color: "white",
    border: "none",
    borderRadius: 5,
    cursor: disabled ? "default" : "pointer",
    fontSize: 11,
    fontWeight: 600,
    opacity: disabled ? 0.6 : 1,
  };
}

function btnSecondary(disabled: boolean): React.CSSProperties {
  return {
    padding: "2px 7px",
    background: "transparent",
    border: "1px solid var(--af-border-subtle)",
    borderRadius: 4,
    fontSize: 10,
    color: "var(--af-text-secondary)",
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.6 : 1,
  };
}
