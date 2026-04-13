"use client";

import { useMemo, useState } from "react";
import type { UsageSnapshot, UsageWindow } from "@/lib/usage-data";

type SeriesKey = "five_hour" | "seven_day" | "seven_day_sonnet";

/**
 * Sprint-burndown-style chart for a single usage window.
 *
 * Y-axis: remaining budget (100% at start, 0% when quota is exhausted)
 * X-axis: time from window start to reset
 *
 * Ideal line: dashed diagonal from (windowStart, 100%) to (resetsAt, 0%)
 *   — the "sustainable burn" trajectory
 * Actual line: solid, plots (100 - utilization) at each snapshot's captured_at
 *
 * ABOVE the ideal line = saving budget (more left than expected, good)
 * BELOW the ideal line = burning faster than sustainable (bad)
 */
export function UsageChart({
  snapshots,
  seriesKey,
  title,
  windowMs,
  color,
}: {
  snapshots: UsageSnapshot[];
  seriesKey: SeriesKey;
  title: string;
  /** Rolling window duration in milliseconds (5h, 7d, etc.). */
  windowMs: number;
  /** Actual-line color for this window. */
  color: string;
}) {
  const width = 800;
  const height = 260;
  const padding = { top: 20, right: 20, bottom: 40, left: 52 };

  const computed = useMemo(() => {
    const valid = snapshots
      .map((s) => ({ capturedAt: new Date(s.captured_at).getTime(), window: s[seriesKey] }))
      .filter(
        (x): x is { capturedAt: number; window: UsageWindow } =>
          x.window !== null && x.window.utilization !== null,
      );

    if (valid.length === 0) return null;

    const latest = valid[valid.length - 1]!;
    const resetsAt = latest.window.resets_at ? new Date(latest.window.resets_at).getTime() : null;
    if (!resetsAt) return null;

    const windowStart = resetsAt - windowMs;
    const now = Date.now();
    const currentRemaining = 100 - (latest.window.utilization ?? 0);

    // Plot (captured_at, remaining = 100 - utilization) within the window
    const points = valid
      .filter((x) => x.capturedAt >= windowStart && x.capturedAt <= resetsAt)
      .map((x) => [x.capturedAt, 100 - (x.window.utilization ?? 0)] as const);

    return { points, windowStart, windowEnd: resetsAt, now, currentRemaining, latest };
  }, [snapshots, seriesKey, windowMs]);

  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const [hover, setHover] = useState<{ x: number; t: number; actual: number; ideal: number } | null>(
    null,
  );

  if (!computed) {
    return (
      <div className="rounded-lg border border-af-border bg-af-surface p-6">
        <div className="text-sm font-medium">{title}</div>
        <div className="mt-4 text-center text-xs text-af-muted">No data for this window yet.</div>
      </div>
    );
  }

  const { points, windowStart, windowEnd, now, currentRemaining, latest } = computed;

  const xScale = (t: number): number =>
    padding.left + ((t - windowStart) / (windowEnd - windowStart)) * plotW;
  const yScale = (v: number): number => padding.top + plotH - (v / 100) * plotH;
  const unXScale = (x: number): number =>
    windowStart + ((x - padding.left) / plotW) * (windowEnd - windowStart);

  // Ideal line: 100% remaining at windowStart → 0% remaining at resetsAt
  const idealAt = (t: number): number => {
    const pctThroughWindow = (t - windowStart) / (windowEnd - windowStart);
    return Math.max(0, Math.min(100, 100 - pctThroughWindow * 100));
  };

  // Actual remaining at "now" (interpolated from the closest data point — latest)
  const nowIdeal = idealAt(now);
  const delta = currentRemaining - nowIdeal;
  // Positive delta = MORE remaining than ideal = ahead of schedule (good)
  const tone =
    delta < -10 ? "text-red-500" : delta < 0 ? "text-amber-500" : "text-emerald-500";
  const toneLabel =
    delta < -10 ? "behind schedule" : delta < 0 ? "slightly behind" : "on track";

  const linePath =
    points.length > 0
      ? points
          .map(([t, v], i) => `${i === 0 ? "M" : "L"} ${xScale(t).toFixed(1)} ${yScale(v).toFixed(1)}`)
          .join(" ")
      : "";

  // Area under the actual line — fill to show "saved budget" vs ideal
  const areaPath =
    points.length > 0
      ? `${linePath} L ${xScale(points[points.length - 1]![0]).toFixed(1)} ${yScale(0).toFixed(1)} L ${xScale(points[0]![0]).toFixed(1)} ${yScale(0).toFixed(1)} Z`
      : "";

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * width;
    if (svgX < padding.left || svgX > width - padding.right) {
      setHover(null);
      return;
    }
    const t = unXScale(svgX);
    // Find nearest actual data point
    let nearest = points[0]!;
    let nearestDist = Math.abs(nearest[0] - t);
    for (const p of points) {
      const d = Math.abs(p[0] - t);
      if (d < nearestDist) {
        nearest = p;
        nearestDist = d;
      }
    }
    setHover({ x: xScale(nearest[0]), t: nearest[0], actual: nearest[1], ideal: idealAt(nearest[0]) });
  };

  return (
    <div className="rounded-lg border border-af-border bg-af-surface p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <div>
          <div className="text-sm font-medium">{title}</div>
          <div className="text-xs text-af-muted">
            Window: {formatWindowSize(windowMs)} · resets {formatRelative(new Date(windowEnd).toISOString())}
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold tabular-nums" style={{ color }}>
            {currentRemaining.toFixed(1)}%
          </div>
          <div className="text-xs text-af-muted">remaining</div>
          <div className={`text-xs ${tone}`}>
            {toneLabel} ({delta >= 0 ? "+" : ""}
            {delta.toFixed(1)}%)
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="mb-2 flex gap-4 text-[11px] text-af-muted">
        <span className="flex items-center gap-1.5">
          <svg width="18" height="6">
            <line x1="0" y1="3" x2="18" y2="3" stroke="currentColor" strokeDasharray="3 2" strokeOpacity="0.5" />
          </svg>
          Ideal (sustainable burn)
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="18" height="6">
            <line x1="0" y1="3" x2="18" y2="3" stroke={color} strokeWidth="2" />
          </svg>
          Actual
        </span>
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="h-56 w-full"
          preserveAspectRatio="none"
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
                  stroke="currentColor"
                  strokeOpacity="0.08"
                />
                <text
                  x={padding.left - 8}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-current text-[10px] opacity-50"
                >
                  {pct}%
                </text>
              </g>
            );
          })}

          {/* Y-axis label */}
          <text
            x={14}
            y={padding.top + plotH / 2}
            textAnchor="middle"
            transform={`rotate(-90, 14, ${padding.top + plotH / 2})`}
            className="fill-current text-[10px] opacity-60"
          >
            Remaining budget (%)
          </text>

          {/* X-axis labels */}
          <text
            x={padding.left}
            y={height - 22}
            textAnchor="start"
            className="fill-current text-[10px] opacity-60"
          >
            Start
          </text>
          <text
            x={width - padding.right}
            y={height - 22}
            textAnchor="end"
            className="fill-current text-[10px] opacity-60"
          >
            Reset
          </text>
          <text
            x={padding.left + plotW / 2}
            y={height - 6}
            textAnchor="middle"
            className="fill-current text-[10px] opacity-60"
          >
            Time
          </text>

          {/* Area fill under actual line */}
          <path d={areaPath} fill={color} fillOpacity="0.08" />

          {/* Ideal diagonal (100% → 0%) */}
          <line
            x1={xScale(windowStart)}
            y1={yScale(100)}
            x2={xScale(windowEnd)}
            y2={yScale(0)}
            stroke="currentColor"
            strokeOpacity="0.4"
            strokeWidth="1.5"
            strokeDasharray="4 3"
          />

          {/* Current-time vertical marker */}
          {now >= windowStart && now <= windowEnd && (
            <g>
              <line
                x1={xScale(now)}
                y1={padding.top}
                x2={xScale(now)}
                y2={padding.top + plotH}
                stroke="currentColor"
                strokeOpacity="0.3"
                strokeWidth="1"
              />
              <text
                x={xScale(now)}
                y={padding.top - 6}
                textAnchor="middle"
                className="fill-current text-[10px] opacity-60"
              >
                now
              </text>
            </g>
          )}

          {/* Actual data line */}
          <path
            d={linePath}
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Data point dots */}
          {points.map(([t, v], i) => (
            <circle key={i} cx={xScale(t)} cy={yScale(v)} r="3" fill={color} />
          ))}

          {/* Hover crosshair + tooltip dot */}
          {hover && (
            <g>
              <line
                x1={hover.x}
                y1={padding.top}
                x2={hover.x}
                y2={padding.top + plotH}
                stroke="currentColor"
                strokeOpacity="0.5"
                strokeWidth="1"
                strokeDasharray="2 2"
              />
              <circle cx={hover.x} cy={yScale(hover.actual)} r="5" fill={color} stroke="white" strokeWidth="1.5" />
            </g>
          )}
        </svg>

        {/* HTML tooltip (positioned using percentage) */}
        {hover && (
          <div
            className="pointer-events-none absolute rounded-md border border-af-border bg-af-bg px-3 py-2 text-xs shadow-lg"
            style={{
              left: `${(hover.x / width) * 100}%`,
              top: "8px",
              transform: "translateX(-50%)",
            }}
          >
            <div className="font-medium">{new Date(hover.t).toLocaleString()}</div>
            <div className="mt-1 flex gap-3">
              <div>
                <span className="text-af-muted">Actual</span>{" "}
                <span className="font-semibold tabular-nums" style={{ color }}>
                  {hover.actual.toFixed(1)}%
                </span>
              </div>
              <div>
                <span className="text-af-muted">Ideal</span>{" "}
                <span className="font-semibold tabular-nums">{hover.ideal.toFixed(1)}%</span>
              </div>
            </div>
            <div className="mt-0.5 text-af-muted">
              Δ {(hover.actual - hover.ideal >= 0 ? "+" : "")}
              {(hover.actual - hover.ideal).toFixed(1)}%
            </div>
          </div>
        )}
      </div>

      <div className="mt-2 flex justify-between text-[10px] text-af-muted">
        <span>{new Date(windowStart).toLocaleString()}</span>
        <span>
          {points.length} snapshot{points.length === 1 ? "" : "s"} · last{" "}
          {formatRelative(new Date(latest.capturedAt).toISOString())}
        </span>
        <span>{new Date(windowEnd).toLocaleString()}</span>
      </div>
    </div>
  );
}

function formatWindowSize(ms: number): string {
  const hours = ms / (60 * 60 * 1000);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = hours / 24;
  return `${days} day${days === 1 ? "" : "s"}`;
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.round((then - now) / 1000);
  const abs = Math.abs(diffSec);
  const past = diffSec < 0;

  let value: string;
  if (abs < 60) {
    value = `${abs}s`;
  } else if (abs < 3600) {
    value = `${Math.floor(abs / 60)}m`;
  } else if (abs < 86400) {
    const h = Math.floor(abs / 3600);
    const m = Math.floor((abs % 3600) / 60);
    value = m > 0 ? `${h}h${m}m` : `${h}h`;
  } else {
    const d = Math.floor(abs / 86400);
    const h = Math.floor((abs % 86400) / 3600);
    value = h > 0 ? `${d}d${h}h` : `${d}d`;
  }

  return past ? `${value} ago` : `in ${value}`;
}
