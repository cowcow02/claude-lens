"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Phase = "idle" | "running" | "done" | "error";

/**
 * Slim today-hero shown above YesterdayHero on the home page.
 * Renders a CTA to generate today's digest. The digest is never
 * persisted (today is in-flight per spec) so this is always a
 * fresh-LLM-call action; we don't store the result, just navigate
 * the user to /day/today after it lands.
 */
export function TodayHero({ todayDate, hasEntries }: { todayDate: string; hasEntries: boolean }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState<string>("");

  // Listen for an existing in-flight job for today's digest from the queue.
  useEffect(() => {
    if (!hasEntries) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/jobs", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json() as { jobs: Array<{ kind: string; target: string; status: string; progress: { phase: string } | null }> };
        const today = data.jobs.find((j) => j.kind === "digest.day" && j.target === todayDate);
        if (today && !cancelled) {
          if (today.status === "running") setPhase("running");
          else if (today.status === "done") setPhase("done");
        }
      } catch { /* ignore */ }
    };
    void tick();
    const id = setInterval(tick, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, [todayDate, hasEntries]);

  // Empty today — don't claim screen real estate. Once a session runs,
  // /api/events fires, the layout re-renders, and the hero appears.
  if (!hasEntries) return null;

  const trigger = async () => {
    setPhase("running");
    setProgress("Starting…");
    try {
      const res = await fetch(`/api/digest/day/${todayDate}`, { method: "POST" });
      if (!res.ok || !res.body) {
        setPhase("error");
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
            else if (ev.type === "entry") setProgress(`Enriching ${ev.index}/${ev.total}…`);
            else if (ev.type === "progress") {
              const sec = Math.round(ev.elapsed_ms / 1000);
              setProgress(`Composing… ${sec}s`);
            }
            else if (ev.type === "error") { setPhase("error"); setProgress(ev.message); return; }
          } catch { /* skip */ }
        }
      }
      setPhase("done");
      setProgress("Done.");
    } catch (e) {
      setPhase("error");
      setProgress((e as Error).message);
    }
  };

  return (
    <div
      className="af-panel"
      style={{
        padding: "12px 18px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 200 }}>
        <span
          style={{
            fontSize: 11,
            color: "var(--af-text-tertiary)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            fontWeight: 600,
          }}
        >
          Today · in flight
        </span>
        <span style={{ fontSize: 13, color: "var(--af-text)" }}>
          {phase === "done"
            ? "Today's digest is ready."
            : phase === "running"
              ? progress || "Generating today's digest…"
              : phase === "error"
                ? `Failed: ${progress}`
                : "Generate a snapshot digest of today's work so far."}
        </span>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {phase === "done" ? (
          <Link
            href={`/day/${todayDate}`}
            style={{
              padding: "6px 14px",
              background: "var(--af-accent)",
              color: "white",
              borderRadius: 6,
              textDecoration: "none",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Open today's digest →
          </Link>
        ) : (
          <button
            type="button"
            onClick={trigger}
            disabled={phase === "running"}
            style={{
              padding: "6px 14px",
              background: phase === "running" ? "var(--af-surface-hover)" : "var(--af-accent)",
              color: phase === "running" ? "var(--af-text-tertiary)" : "white",
              border: "none",
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              cursor: phase === "running" ? "default" : "pointer",
            }}
          >
            {phase === "running" ? "Generating…" : "Generate today's digest"}
          </button>
        )}
      </div>
    </div>
  );
}
