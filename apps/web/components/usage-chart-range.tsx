"use client";

import { useMemo, useState } from "react";
import type { UsageSnapshot, UsageWindow } from "@/lib/usage-data";

type SeriesKey = "five_hour" | "seven_day" | "seven_day_sonnet";

/**
 * Line chart showing utilization % over an arbitrary date range — used
 * in the fullscreen modal when the user picks "7D / 30D / 90D / Custom".
 *
 * Unlike the single-cycle burndown, this is a plain time-series plot:
 *   - X-axis: time (startMs → endMs)
 *   - Y-axis: utilization % (0–100)
 *   - Line: actual utilization at each captured snapshot
 *   - Vertical markers at cycle boundaries (moments when the window reset)
 *   - Dots: per-cycle peak markers with their %
 *
 * The "ideal burn" diagonal only makes sense per-cycle, so it's omitted
 * here — instead the chart highlights cycle shape and peak patterns
 * across time.
 */
export function UsageChartRange({
  snapshots,
  seriesKey,
  startMs,
  endMs,
  colorVar,
}: {
  snapshots: UsageSnapshot[];
  seriesKey: SeriesKey;
  startMs: number;
  endMs: number;
  colorVar: string;
}) {
  const width = 1280;
  const height = 320;
  const padding = { top: 24, right: 32, bottom: 44, left: 56 };

  const computed = useMemo(() => {
    // Filter and extract valid utilization points within range.
    const valid: { t: number; u: number; resetsAt: string | null }[] = [];
    for (const snap of snapshots) {
      const t = new Date(snap.captured_at).getTime();
      if (t < startMs || t > endMs) continue;
      const w = snap[seriesKey];
      if (!w || w.utilization === null) continue;
      valid.push({ t, u: w.utilization, resetsAt: w.resets_at });
    }

    if (valid.length === 0) return null;

    // Cycle detection — whenever resets_at changes between snapshots,
    // a new rolling window started.
    type Cycle = { start: number; end: number; peak: number; peakT: number; points: typeof valid };
    const cycles: Cycle[] = [];
    let current: typeof valid = [];
    let prevResetsAt: string | null = null;

    for (const p of valid) {
      if (prevResetsAt !== null && p.resetsAt !== prevResetsAt) {
        // Close the previous cycle
        if (current.length) {
          const peakIdx = current.reduce(
            (best, cur, i, arr) => (cur.u > arr[best]!.u ? i : best),
            0,
          );
          cycles.push({
            start: current[0]!.t,
            end: current[current.length - 1]!.t,
            peak: current[peakIdx]!.u,
            peakT: current[peakIdx]!.t,
            points: current,
          });
        }
        current = [];
      }
      current.push(p);
      prevResetsAt = p.resetsAt;
    }
    if (current.length) {
      const peakIdx = current.reduce(
        (best, cur, i, arr) => (cur.u > arr[best]!.u ? i : best),
        0,
      );
      cycles.push({
        start: current[0]!.t,
        end: current[current.length - 1]!.t,
        peak: current[peakIdx]!.u,
        peakT: current[peakIdx]!.t,
        points: current,
      });
    }

    return { valid, cycles };
  }, [snapshots, seriesKey, startMs, endMs]);

  const [hover, setHover] = useState<{
    x: number;
    t: number;
    u: number;
  } | null>(null);

  if (!computed || computed.valid.length === 0) {
    return (
      <div
        className="af-card"
        style={{
          padding: "40px 32px",
          textAlign: "center",
          fontSize: 12,
          color: "var(--af-text-tertiary)",
        }}
      >
        No usage data in the selected range.
      </div>
    );
  }

  const { valid, cycles } = computed;
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const xScale = (t: number): number =>
    padding.left + ((t - startMs) / (endMs - startMs)) * plotW;
  const yScale = (u: number): number =>
    padding.top + plotH - (u / 100) * plotH;
  const unXScale = (x: number): number =>
    startMs + ((x - padding.left) / plotW) * (endMs - startMs);

  const linePath = valid
    .map(
      (p, i) => `${i === 0 ? "M" : "L"} ${xScale(p.t).toFixed(1)} ${yScale(p.u).toFixed(1)}`,
    )
    .join(" ");

  // Summary stats
  const peakOverall = Math.max(...valid.map((p) => p.u));
  const avgPeak =
    cycles.length > 0
      ? cycles.reduce((sum, c) => sum + c.peak, 0) / cycles.length
      : peakOverall;
  const completeCycles = cycles.length > 1 ? cycles.length - 1 : 0;

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * width;
    if (svgX < padding.left || svgX > width - padding.right) {
      setHover(null);
      return;
    }
    const targetT = unXScale(svgX);
    let nearest = valid[0]!;
    let nearestDist = Math.abs(nearest.t - targetT);
    for (const p of valid) {
      const d = Math.abs(p.t - targetT);
      if (d < nearestDist) {
        nearest = p;
        nearestDist = d;
      }
    }
    setHover({ x: xScale(nearest.t), t: nearest.t, u: nearest.u });
  };

  return (
    <div
      className="af-card"
      style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 10 }}
    >
      {/* Stat strip */}
      <div
        style={{
          display: "flex",
          gap: 28,
          fontSize: 11,
          color: "var(--af-text-tertiary)",
          flexWrap: "wrap",
        }}
      >
        <Stat label="Peak" value={`${peakOverall.toFixed(1)}%`} color={colorVar} />
        <Stat
          label="Avg peak per cycle"
          value={cycles.length > 1 ? `${avgPeak.toFixed(1)}%` : "—"}
          color={colorVar}
        />
        <Stat
          label="Complete cycles"
          value={String(completeCycles)}
          color="var(--af-text)"
        />
        <Stat label="Snapshots" value={String(valid.length)} color="var(--af-text)" />
      </div>

      {/* Chart */}
      <div style={{ position: "relative" }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{
            width: "100%",
            aspectRatio: `${width} / ${height}`,
            display: "block",
          }}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHover(null)}
        >
          {/* Horizontal gridlines */}
          {[0, 25, 50, 75, 100].map((pct) => {
            const y = yScale(pct);
            return (
              <g key={pct}>
                <line
                  x1={padding.left}
                  x2={width - padding.right}
                  y1={y}
                  y2={y}
                  stroke="var(--af-border-subtle)"
                  strokeWidth="1"
                />
                <text
                  x={padding.left - 8}
                  y={y + 4}
                  textAnchor="end"
                  fontSize="11"
                  fill="var(--af-text-tertiary)"
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
            fill="var(--af-danger)"
            fillOpacity="0.06"
          />
          <rect
            x={padding.left}
            y={yScale(90)}
            width={plotW}
            height={yScale(70) - yScale(90)}
            fill="var(--af-warning)"
            fillOpacity="0.05"
          />

          {/* Cycle boundary markers (vertical dashed lines between cycles) */}
          {cycles.slice(0, -1).map((c, i) => {
            // Boundary is halfway between this cycle's end and the next cycle's start.
            const nextStart = cycles[i + 1]!.start;
            const midT = (c.end + nextStart) / 2;
            return (
              <line
                key={`cycle-${i}`}
                x1={xScale(midT)}
                y1={padding.top}
                x2={xScale(midT)}
                y2={padding.top + plotH}
                stroke="var(--af-text-tertiary)"
                strokeOpacity="0.35"
                strokeWidth="1"
                strokeDasharray="2 3"
              />
            );
          })}

          {/* Actual data line */}
          <path
            d={linePath}
            fill="none"
            stroke={colorVar}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Peak markers per cycle */}
          {cycles.map((c, i) => (
            <g key={`peak-${i}`}>
              <circle
                cx={xScale(c.peakT)}
                cy={yScale(c.peak)}
                r="4"
                fill={colorVar}
                stroke="var(--background)"
                strokeWidth="1.5"
              />
              <text
                x={xScale(c.peakT)}
                y={yScale(c.peak) - 8}
                textAnchor="middle"
                fontSize="10"
                fontWeight="600"
                fill={colorVar}
              >
                {c.peak.toFixed(0)}%
              </text>
            </g>
          ))}

          {/* Hover crosshair */}
          {hover && (
            <g>
              <line
                x1={hover.x}
                y1={padding.top}
                x2={hover.x}
                y2={padding.top + plotH}
                stroke="var(--af-text-secondary)"
                strokeOpacity="0.6"
                strokeWidth="1"
                strokeDasharray="2 2"
              />
              <circle
                cx={hover.x}
                cy={yScale(hover.u)}
                r="5"
                fill={colorVar}
                stroke="var(--background)"
                strokeWidth="2"
              />
            </g>
          )}

          {/* X-axis endpoint labels */}
          <text
            x={padding.left}
            y={height - 20}
            textAnchor="start"
            fontSize="10"
            fill="var(--af-text-tertiary)"
            suppressHydrationWarning
          >
            {formatAxisDate(startMs)}
          </text>
          <text
            x={width - padding.right}
            y={height - 20}
            textAnchor="end"
            fontSize="10"
            fill="var(--af-text-tertiary)"
            suppressHydrationWarning
          >
            {formatAxisDate(endMs)}
          </text>
          <text
            x={padding.left + plotW / 2}
            y={height - 6}
            textAnchor="middle"
            fontSize="10"
            fill="var(--af-text-tertiary)"
          >
            Time · {cycles.length} cycle{cycles.length === 1 ? "" : "s"} in view
          </text>
        </svg>

        {/* Hover tooltip */}
        {hover && (
          <div
            suppressHydrationWarning
            style={{
              pointerEvents: "none",
              position: "absolute",
              left: `${(hover.x / width) * 100}%`,
              top: 6,
              transform: "translateX(-50%)",
              background: "var(--af-surface-elevated)",
              border: "1px solid var(--af-border-subtle)",
              borderRadius: 8,
              padding: "8px 12px",
              fontSize: 11,
              boxShadow: "0 6px 24px rgba(0, 0, 0, 0.24)",
              whiteSpace: "nowrap",
              color: "var(--af-text)",
            }}
          >
            <div style={{ fontWeight: 600 }}>{new Date(hover.t).toLocaleString()}</div>
            <div style={{ marginTop: 2 }}>
              <span style={{ color: "var(--af-text-tertiary)" }}>Utilization</span>{" "}
              <span
                style={{
                  fontWeight: 600,
                  fontVariantNumeric: "tabular-nums",
                  color: colorVar,
                }}
              >
                {hover.u.toFixed(1)}%
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span
        style={{
          fontSize: 9,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--af-text-tertiary)",
          fontWeight: 600,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 18,
          fontWeight: 700,
          letterSpacing: "-0.01em",
          color,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function formatAxisDate(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
