"use client";

import { useEffect, useState } from "react";

export type BackfillRow = {
  date: string;
  day_label: string;
  entry_count: number;
  pr_count: number;
  status: "generated" | "pending" | "empty";
};

/**
 * Side drawer that lets the user select multiple days and enqueue
 * digest generation. Heavy lifting is delegated to the central job
 * queue: the drawer just kicks off POSTs to /api/digest/day/[date]
 * (which registers a job in the queue) and can be safely closed —
 * progress is visible in the JobQueueWidget.
 */
export function BackfillDrawer({
  open,
  onClose,
  rows,
  aiEnabled,
}: {
  open: boolean;
  onClose: () => void;
  rows: BackfillRow[];
  aiEnabled: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [forceMode, setForceMode] = useState(false);

  // Close on ESC.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const toggle = (d: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d); else next.add(d);
      return next;
    });
  };
  const selectPending = () =>
    setSelected(new Set(rows.filter(r => r.status === "pending").map(r => r.date)));
  const selectMissing = () =>
    setSelected(new Set(rows.filter(r => r.status !== "empty").map(r => r.date)));
  const clear = () => setSelected(new Set());

  const enqueue = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    // Fire all POSTs sequentially. The server registers a job for each
    // and the queue widget shows progress; the drawer doesn't need to
    // track per-day state itself.
    const dates = Array.from(selected).sort().reverse();
    try {
      for (const d of dates) {
        const url = `/api/digest/day/${d}${forceMode ? "?force=1" : ""}`;
        // Fire-and-stream: we read the SSE stream to drain the response,
        // but don't need to parse anything — the queue widget polls
        // /api/jobs and displays everything.
        const res = await fetch(url, { method: "POST" });
        if (res.body) {
          const reader = res.body.getReader();
          while (true) {
            const r = await reader.read();
            if (r.done) break;
          }
        }
      }
    } finally {
      setBusy(false);
      setSelected(new Set());
    }
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.4)",
        zIndex: 200,
        display: "flex",
        justifyContent: "flex-end",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(440px, 100%)",
          height: "100%",
          background: "var(--af-surface-elevated)",
          borderLeft: "1px solid var(--af-border-subtle)",
          display: "flex",
          flexDirection: "column",
          boxShadow: "-12px 0 32px rgba(0,0,0,0.25)",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 18px",
            borderBottom: "1px solid var(--af-border-subtle)",
          }}
        >
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Backfill digests</h2>
            <p
              style={{
                fontSize: 11,
                color: "var(--af-text-tertiary)",
                margin: "2px 0 0",
              }}
            >
              Each selected day enqueues a job. You can close this drawer.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--af-text-tertiary)",
              fontSize: 22,
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </header>

        {!aiEnabled && (
          <div
            style={{
              padding: 12,
              margin: 18,
              background: "rgba(237,137,54,0.1)",
              borderRadius: 6,
              fontSize: 12,
              color: "var(--af-text)",
            }}
          >
            AI features are off — only deterministic digests will be written. Enable AI in Settings to generate narratives.
          </div>
        )}

        <div
          style={{
            display: "flex",
            gap: 6,
            padding: "10px 18px",
            borderBottom: "1px solid var(--af-border-subtle)",
            flexWrap: "wrap",
            fontSize: 11,
          }}
        >
          <ActionBtn onClick={selectPending}>Select pending</ActionBtn>
          <ActionBtn onClick={selectMissing}>Select all with entries</ActionBtn>
          <ActionBtn onClick={clear}>Clear</ActionBtn>
          <label
            style={{
              marginLeft: "auto",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 11,
              color: "var(--af-text-secondary)",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={forceMode}
              onChange={(e) => setForceMode(e.target.checked)}
            />
            force regen
          </label>
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          {rows.map((r) => (
            <label
              key={r.date}
              style={{
                display: "grid",
                gridTemplateColumns: "auto 110px 80px 1fr",
                gap: 10,
                alignItems: "center",
                padding: "8px 18px",
                borderBottom: "1px solid var(--af-border-subtle)",
                fontSize: 12,
                cursor: r.status === "empty" ? "default" : "pointer",
                opacity: r.status === "empty" ? 0.5 : 1,
              }}
            >
              <input
                type="checkbox"
                disabled={r.status === "empty"}
                checked={selected.has(r.date)}
                onChange={() => toggle(r.date)}
              />
              <span>{r.day_label}</span>
              <span
                style={{
                  fontSize: 10,
                  color: r.status === "generated" ? "#48bb78" : r.status === "pending" ? "#ed8936" : "var(--af-text-tertiary)",
                }}
              >
                {r.status === "generated" ? "✓ ready" : r.status === "pending" ? "• pending" : "—"}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  color: "var(--af-text-tertiary)",
                  textAlign: "right",
                }}
              >
                {r.entry_count > 0 ? `${r.entry_count} sess` : ""}
                {r.pr_count > 0 ? ` · ${r.pr_count} PR` : ""}
              </span>
            </label>
          ))}
        </div>

        <footer
          style={{
            padding: "12px 18px",
            borderTop: "1px solid var(--af-border-subtle)",
            display: "flex",
            gap: 10,
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: 12, color: "var(--af-text-secondary)", flex: 1 }}>
            {selected.size} day{selected.size === 1 ? "" : "s"} selected
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: "6px 12px",
              background: "transparent",
              border: "1px solid var(--af-border-subtle)",
              borderRadius: 6,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={enqueue}
            disabled={busy || selected.size === 0}
            style={{
              padding: "6px 14px",
              background: "var(--af-accent)",
              color: "white",
              border: "none",
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              cursor: busy || selected.size === 0 ? "default" : "pointer",
              opacity: busy || selected.size === 0 ? 0.6 : 1,
            }}
          >
            {busy ? `Enqueueing… (${selected.size})` : `Generate ${selected.size}`}
          </button>
        </footer>
      </div>
    </div>
  );
}

function ActionBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "3px 10px",
        background: "transparent",
        border: "1px solid var(--af-border-subtle)",
        borderRadius: 5,
        fontSize: 11,
        color: "var(--af-text-secondary)",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
