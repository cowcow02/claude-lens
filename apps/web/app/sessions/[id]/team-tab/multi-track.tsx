"use client";

import { useMemo } from "react";
import type { MultiTrackProps } from "./adapter";

type Props = MultiTrackProps & { zoom: number };

type CellEntry = { kind: string; label: string; preview: string };
type MergedRow = {
  tsMs: number;
  // Arrays per track so multiple events on the same track within the merge
  // window are all shown, not silently overwritten.
  cells: Map<string, CellEntry[]>;
};

export function MultiTrack({
  tracks,
  firstEventMs,
  lastEventMs,
  zoom,
}: Props) {
  const rows = useMemo(() => mergeRows(tracks), [tracks]);
  const total = Math.max(1, lastEventMs - firstEventMs);

  return (
    <div style={{
      display: "grid",
      gap: 0,
      border: "1px solid var(--af-border-subtle)",
      borderRadius: 6,
      overflow: "hidden",
      gridTemplateColumns: `80px repeat(${tracks.length}, minmax(240px, 1fr))`,
      fontFamily: "ui-monospace, monospace",
      fontSize: 11,
    }}>
      <div style={{
        position: "sticky", top: 0,
        background: "var(--af-surface-hover)",
        padding: 8,
        fontSize: 9,
        color: "var(--af-text-tertiary, #888)",
        borderBottom: "1px solid var(--af-border-subtle)",
      }}>
        TIME
      </div>
      {tracks.map((t) => (
        <div
          key={t.id}
          style={{
            position: "sticky", top: 0,
            background: "var(--af-surface-hover)",
            padding: 8,
            borderBottom: "1px solid var(--af-border-subtle)",
            borderLeft: "1px solid var(--af-border-subtle)",
            fontWeight: 600,
            color: t.color,
          }}
        >
          {t.isLead ? "LEAD" : t.label}
        </div>
      ))}

      {rows.map((row, i) => {
        const next = rows[i + 1];
        const gapMs = next ? next.tsMs - row.tsMs : 0;
        const strictHeight = Math.max(24, (gapMs / total) * 1800);
        const anchoredHeight = 36;
        const height = anchoredHeight + (strictHeight - anchoredHeight) * zoom;

        return (
          <div key={i} style={{ display: "contents" }}>
            <div style={{
              padding: 8,
              fontSize: 9,
              color: "var(--af-text-tertiary, #888)",
              borderBottom: "1px solid var(--af-border-subtle)",
              display: "flex", alignItems: "flex-start",
              minHeight: height,
            }}>
              {formatTime(row.tsMs)}
            </div>
            {tracks.map((t) => {
              const entries = row.cells.get(t.id);
              return (
                <div
                  key={t.id}
                  style={{
                    padding: 8,
                    borderBottom: "1px solid var(--af-border-subtle)",
                    borderLeft: "1px solid var(--af-border-subtle)",
                    display: "flex", flexDirection: "column", gap: 4,
                    minHeight: height,
                  }}
                >
                  {entries && entries.length > 0 ? (
                    entries.map((cell, ci) => (
                      <div key={ci}>
                        <div style={{ fontSize: 9, marginBottom: 2, color: t.color }}>
                          {cell.label}
                        </div>
                        <div style={{ color: "var(--af-text)", lineHeight: 1.3 }}>
                          {cell.preview}
                        </div>
                      </div>
                    ))
                  ) : (
                    <span style={{
                      color: "var(--af-text-tertiary, #666)",
                      fontStyle: "italic",
                      opacity: 0.4,
                    }}>· idle ·</span>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function mergeRows(tracks: MultiTrackProps["tracks"]): MergedRow[] {
  type Entry = {
    tsMs: number;
    trackId: string;
    kind: string;
    label: string;
    preview: string;
  };
  const all: Entry[] = [];
  for (const t of tracks) {
    for (const r of t.rows) {
      all.push({
        tsMs: r.tsMs,
        trackId: t.id,
        kind: r.kind,
        label: r.label,
        preview: r.preview,
      });
    }
  }
  all.sort((a, b) => a.tsMs - b.tsMs);

  const merged: MergedRow[] = [];
  const WINDOW_MS = 2_000;
  for (const e of all) {
    const last = merged[merged.length - 1];
    const entry: CellEntry = { kind: e.kind, label: e.label, preview: e.preview };
    if (last && e.tsMs - last.tsMs <= WINDOW_MS) {
      const arr = last.cells.get(e.trackId) ?? [];
      arr.push(entry);
      last.cells.set(e.trackId, arr);
    } else {
      merged.push({
        tsMs: e.tsMs,
        cells: new Map([[e.trackId, [entry]]]),
      });
    }
  }
  return merged;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
