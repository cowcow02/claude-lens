"use client";

import { useMemo } from "react";
import type { UsageSnapshot } from "@/lib/usage-data";

type SeriesKey = "five_hour" | "seven_day" | "seven_day_opus" | "seven_day_sonnet";

const SERIES: { key: SeriesKey; label: string; color: string }[] = [
  { key: "five_hour", label: "5 hour", color: "#22c55e" },
  { key: "seven_day", label: "7 day", color: "#3b82f6" },
  { key: "seven_day_opus", label: "Opus 7d", color: "#a855f7" },
  { key: "seven_day_sonnet", label: "Sonnet 7d", color: "#f59e0b" },
];

export function UsageChart({ snapshots }: { snapshots: UsageSnapshot[] }) {
  const width = 800;
  const height = 240;
  const padding = { top: 16, right: 16, bottom: 28, left: 36 };

  const { points, minT, maxT } = useMemo(() => {
    if (snapshots.length === 0) {
      return { points: {} as Record<SeriesKey, [number, number][]>, minT: 0, maxT: 0 };
    }
    const times = snapshots.map((s) => new Date(s.captured_at).getTime());
    const minT = Math.min(...times);
    const maxT = Math.max(...times);
    const points = {} as Record<SeriesKey, [number, number][]>;
    for (const { key } of SERIES) {
      points[key] = [];
      for (const snap of snapshots) {
        const window = snap[key];
        if (window?.utilization != null) {
          points[key].push([new Date(snap.captured_at).getTime(), window.utilization]);
        }
      }
    }
    return { points, minT, maxT };
  }, [snapshots]);

  if (snapshots.length === 0) {
    return (
      <div className="rounded-lg border border-af-border bg-af-surface p-8 text-center text-sm text-af-muted">
        No usage data yet. Start the daemon with{" "}
        <code className="rounded bg-af-bg px-1.5 py-0.5">cclens daemon start</code> to begin polling every 5 minutes.
      </div>
    );
  }

  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const xScale = (t: number): number => {
    if (maxT === minT) return padding.left + plotW / 2;
    return padding.left + ((t - minT) / (maxT - minT)) * plotW;
  };
  const yScale = (v: number): number => padding.top + plotH - (v / 100) * plotH;

  const paths: Record<SeriesKey, string> = {} as Record<SeriesKey, string>;
  for (const { key } of SERIES) {
    const pts = points[key];
    if (pts.length === 0) {
      paths[key] = "";
      continue;
    }
    paths[key] = pts
      .map(([t, v], i) => `${i === 0 ? "M" : "L"} ${xScale(t).toFixed(1)} ${yScale(v).toFixed(1)}`)
      .join(" ");
  }

  return (
    <div className="rounded-lg border border-af-border bg-af-surface p-4">
      <div className="mb-3 flex flex-wrap gap-3 text-xs">
        {SERIES.map(({ key, label, color }) => (
          <div key={key} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-3 rounded-sm"
              style={{ backgroundColor: color }}
            />
            <span className="text-af-muted">{label}</span>
          </div>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-48 w-full"
        preserveAspectRatio="none"
      >
        {/* Horizontal gridlines at 25/50/75/100% */}
        {[0, 25, 50, 75, 100].map((pct) => {
          const y = yScale(pct);
          return (
            <g key={pct}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
                stroke="currentColor"
                strokeOpacity="0.08"
              />
              <text
                x={padding.left - 6}
                y={y + 4}
                textAnchor="end"
                className="fill-current text-[10px] opacity-50"
              >
                {pct}%
              </text>
            </g>
          );
        })}
        {/* Warning bands */}
        <rect
          x={padding.left}
          y={yScale(100)}
          width={plotW}
          height={yScale(90) - yScale(100)}
          fill="#ef4444"
          fillOpacity="0.06"
        />
        <rect
          x={padding.left}
          y={yScale(90)}
          width={plotW}
          height={yScale(70) - yScale(90)}
          fill="#f59e0b"
          fillOpacity="0.05"
        />
        {/* Series lines */}
        {SERIES.map(({ key, color }) => (
          <path
            key={key}
            d={paths[key]}
            fill="none"
            stroke={color}
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>
      <div className="mt-2 flex justify-between text-xs text-af-muted">
        <span>{new Date(minT).toLocaleString()}</span>
        <span>{snapshots.length} snapshot{snapshots.length === 1 ? "" : "s"}</span>
        <span>{new Date(maxT).toLocaleString()}</span>
      </div>
    </div>
  );
}
