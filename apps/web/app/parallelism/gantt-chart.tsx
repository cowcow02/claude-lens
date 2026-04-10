"use client";

import Link from "next/link";
import { useState } from "react";
import type { GanttDay, GanttSession } from "@claude-lens/parser";
import { formatDuration, formatTokens, prettyProjectName } from "@/lib/format";

/**
 * Per-day Gantt chart showing sessions as horizontal rows with
 * colored active segments and gaps for idle time.
 */

const HOUR_WIDTH = 56;
const ROW_HEIGHT = 32;
const ROW_GAP = 4;
const LABEL_WIDTH = 240;
const HEADER_HEIGHT = 28;

// Color palette for sessions — rotate through so adjacent rows differ.
const PALETTE = [
  "rgba(45, 212, 191, 0.7)",
  "rgba(167, 139, 250, 0.7)",
  "rgba(248, 113, 113, 0.7)",
  "rgba(52, 211, 153, 0.7)",
  "rgba(251, 191, 36, 0.7)",
  "rgba(236, 72, 153, 0.7)",
  "rgba(34, 211, 238, 0.7)",
  "rgba(168, 85, 247, 0.7)",
];

export function GanttChart({ gantt }: { gantt: GanttDay }) {
  const [hover, setHover] = useState<{
    session: GanttSession;
    x: number;
    y: number;
  } | null>(null);

  const totalWidth = LABEL_WIDTH + 24 * HOUR_WIDTH;
  const totalHeight =
    HEADER_HEIGHT + gantt.sessions.length * (ROW_HEIGHT + ROW_GAP) + ROW_GAP;

  const msToX = (ms: number): number => {
    const frac = (ms - gantt.dayStartMs) / (gantt.dayEndMs - gantt.dayStartMs);
    return LABEL_WIDTH + frac * (24 * HOUR_WIDTH);
  };

  return (
    <div
      className="af-panel"
      style={{
        overflow: "auto",
        position: "relative",
      }}
    >
      <div style={{ minWidth: totalWidth }}>
        <svg
          width={totalWidth}
          height={totalHeight}
          style={{ display: "block" }}
          onMouseLeave={() => setHover(null)}
        >
          {/* Hour grid lines + labels */}
          {Array.from({ length: 25 }, (_, h) => {
            const x = LABEL_WIDTH + h * HOUR_WIDTH;
            return (
              <g key={h}>
                <line
                  x1={x}
                  y1={HEADER_HEIGHT}
                  x2={x}
                  y2={totalHeight}
                  stroke="var(--af-border-subtle)"
                  strokeWidth={h % 6 === 0 ? 1 : 0.5}
                  strokeDasharray={h % 6 === 0 ? undefined : "2 4"}
                />
                {h < 24 && (
                  <text
                    x={x + HOUR_WIDTH / 2}
                    y={HEADER_HEIGHT - 8}
                    textAnchor="middle"
                    fontSize={10}
                    fill="var(--af-text-tertiary)"
                  >
                    {h.toString().padStart(2, "0")}:00
                  </text>
                )}
              </g>
            );
          })}

          {/* Session rows */}
          {gantt.sessions.map((session, i) => {
            const y = HEADER_HEIGHT + i * (ROW_HEIGHT + ROW_GAP) + ROW_GAP;
            const color = PALETTE[i % PALETTE.length]!;

            return (
              <g key={session.id}>
                {/* Row background (subtle stripe on odd rows) */}
                <rect
                  x={0}
                  y={y}
                  width={totalWidth}
                  height={ROW_HEIGHT}
                  fill={i % 2 === 0 ? "transparent" : "var(--af-surface-hover)"}
                  opacity={0.3}
                />

                {/* Session label */}
                <foreignObject
                  x={8}
                  y={y}
                  width={LABEL_WIDTH - 16}
                  height={ROW_HEIGHT}
                >
                  <div
                    style={{
                      height: ROW_HEIGHT,
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      overflow: "hidden",
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: 2,
                        background: color,
                        flexShrink: 0,
                      }}
                    />
                    <Link
                      href={`/sessions/${session.id}`}
                      style={{
                        fontSize: 11,
                        color: "var(--af-text)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        lineHeight: 1.2,
                      }}
                      title={session.firstUserPreview ?? session.id}
                    >
                      {session.firstUserPreview
                        ? session.firstUserPreview.slice(0, 50)
                        : prettyProjectName(session.projectName)}
                    </Link>
                  </div>
                </foreignObject>

                {/* Active segments */}
                {session.segments.map((seg, si) => {
                  const x1 = msToX(seg.startMs);
                  const x2 = msToX(seg.endMs);
                  const w = Math.max(x2 - x1, 3);
                  return (
                    <rect
                      key={si}
                      x={x1}
                      y={y + 4}
                      width={w}
                      height={ROW_HEIGHT - 8}
                      fill={color}
                      rx={3}
                      style={{ cursor: "pointer" }}
                      onMouseEnter={(e) => {
                        const svgRect = (
                          e.currentTarget.closest("svg") as SVGElement
                        ).getBoundingClientRect();
                        setHover({
                          session,
                          x: e.clientX - svgRect.left,
                          y: y + ROW_HEIGHT + 4,
                        });
                      }}
                    />
                  );
                })}

                {/* Idle gaps between segments (dashed) */}
                {session.segments.length > 1 &&
                  session.segments.slice(0, -1).map((seg, si) => {
                    const next = session.segments[si + 1]!;
                    const x1 = msToX(seg.endMs);
                    const x2 = msToX(next.startMs);
                    if (x2 - x1 < 4) return null;
                    return (
                      <line
                        key={`idle-${si}`}
                        x1={x1 + 1}
                        y1={y + ROW_HEIGHT / 2}
                        x2={x2 - 1}
                        y2={y + ROW_HEIGHT / 2}
                        stroke={color}
                        strokeWidth={1}
                        strokeDasharray="3 3"
                        opacity={0.4}
                      />
                    );
                  })}

                {/* Active time label at right end */}
                <text
                  x={Math.min(
                    msToX(session.endMs) + 6,
                    totalWidth - 60,
                  )}
                  y={y + ROW_HEIGHT / 2 + 4}
                  fontSize={9}
                  fill="var(--af-text-tertiary)"
                  fontFamily="var(--font-mono)"
                >
                  {formatDuration(session.activeMs)}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Hover tooltip */}
        {hover && (
          <div
            style={{
              position: "absolute",
              left: Math.min(hover.x, totalWidth - 320),
              top: hover.y,
              zIndex: 50,
              background: "var(--af-surface-elevated)",
              border: "1px solid var(--af-border-subtle)",
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: 11,
              color: "var(--af-text)",
              pointerEvents: "none",
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
              maxWidth: 340,
              lineHeight: 1.45,
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {hover.session.firstUserPreview?.slice(0, 80) ??
                prettyProjectName(hover.session.projectName)}
            </div>
            <div
              style={{
                fontSize: 10,
                color: "var(--af-text-secondary)",
                marginBottom: 6,
                fontFamily: "var(--font-mono)",
              }}
            >
              {prettyProjectName(hover.session.projectName)}
              {hover.session.model && ` · ${hover.session.model}`}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 4,
                fontSize: 10,
                color: "var(--af-text-secondary)",
              }}
            >
              <span>Active: {formatDuration(hover.session.activeMs)}</span>
              <span>Segments: {hover.session.segments.length}</span>
              <span>
                Tokens:{" "}
                {formatTokens(
                  hover.session.totalUsage.input +
                    hover.session.totalUsage.cacheRead +
                    hover.session.totalUsage.cacheWrite,
                )}
                /{formatTokens(hover.session.totalUsage.output)}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
