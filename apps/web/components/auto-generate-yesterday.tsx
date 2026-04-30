"use client";

import { useEffect, useState } from "react";

/**
 * Client-only companion that auto-triggers yesterday's digest the first
 * time the home page is loaded on a given local-day. localStorage-gated
 * to one attempt per day so revisits don't re-fire (the user can still
 * manually click Regenerate on the digest page to redo).
 */
export function AutoGenerateYesterday({
  yesterdayDate,
  missing,
  onDone,
}: {
  yesterdayDate: string;
  missing: boolean;
  onDone?: () => void;
}) {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [progress, setProgress] = useState<string>("");

  useEffect(() => {
    if (!missing) return;
    const key = `cclens:autogen-yesterday:${yesterdayDate}`;
    if (typeof window === "undefined") return;
    if (window.localStorage.getItem(key)) return;  // already attempted today
    window.localStorage.setItem(key, "1");

    let cancelled = false;
    (async () => {
      setState("running");
      setProgress("Starting...");
      try {
        const res = await fetch(`/api/digest/day/${yesterdayDate}`, { method: "POST" });
        if (!res.ok || !res.body) { setState("error"); setProgress(`HTTP ${res.status}`); return; }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (!cancelled) {
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
              else if (ev.type === "entry") setProgress(`Enriching ${ev.index}/${ev.total}…`);
              else if (ev.type === "progress") {
                const sec = Math.round(ev.elapsed_ms / 1000);
                setProgress(`Claude composing… ${ev.bytes.toLocaleString()} chars (${sec}s)`);
              }
              else if (ev.type === "digest") setProgress("Almost done…");
              else if (ev.type === "saved") setProgress("Saved.");
              else if (ev.type === "error") { setState("error"); setProgress(ev.message); return; }
            } catch { /* skip */ }
          }
        }
        setState("done");
        setProgress("");
        if (onDone) onDone();
        // Full reload so the hero picks up the persisted digest without a separate fetch.
        if (typeof window !== "undefined") window.location.reload();
      } catch (e) {
        setState("error");
        setProgress((e as Error).message);
      }
    })();

    return () => { cancelled = true; };
  }, [missing, yesterdayDate, onDone]);

  if (!missing || state === "idle") return null;
  const color = state === "error" ? "#f56565" : state === "done" ? "#48bb78" : "var(--af-accent)";
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 8, padding: "4px 10px",
      borderRadius: 99, fontSize: 11, fontWeight: 500,
      background: "var(--af-accent-subtle)", color,
    }}>
      <span style={{
        display: "inline-block", width: 6, height: 6, borderRadius: "50%",
        background: color, animation: state === "running" ? "cclensPulse 1.2s ease-in-out infinite" : undefined,
      }} />
      <span>{state === "running" ? "Generating yesterday's digest" : state === "done" ? "Done" : "Error"}</span>
      {progress && <span style={{ color: "var(--af-text-tertiary)", fontSize: 10 }}>· {progress}</span>}
      <style>{`
        @keyframes cclensPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
      `}</style>
    </div>
  );
}
