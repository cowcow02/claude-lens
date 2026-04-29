import type { CalibrationPoint } from "@/lib/calibration-data";

type Window = "5h" | "7d";

type Props = {
  curve: CalibrationPoint[];
  window: Window;
  width?: number;
  height?: number;
};

// Stand-alone SVG comparison chart. The existing UsageChart is built around
// burndown semantics (remaining budget, sustainable-burn diagonal) — too
// specialized to repurpose for calibration. Drawing both series on one set
// of axes here keeps the validation loop fast.
export function CalibrationComparisonChart({
  curve,
  window,
  width = 1200,
  height = 280,
}: Props) {
  if (curve.length < 2) {
    return (
      <div style={{ fontSize: 12, color: "var(--af-text-tertiary)" }}>
        Calibration curve unavailable. Run{" "}
        <code style={{ fontFamily: "var(--font-mono)" }}>
          python3 /tmp/calibrate2.py
        </code>{" "}
        to populate.
      </div>
    );
  }

  const realKey = window === "5h" ? "real_5h" : "real_7d";
  const predKey = window === "5h" ? "pred_5h" : "pred_7d";

  // Keep all points so we can draw a continuous predicted line, including the
  // pre-daemon back-fill segment where real is null.
  const allPoints = curve
    .filter((c) => Number.isFinite(c[predKey]))
    .map((c) => ({
      ts: new Date(c.ts).getTime(),
      real: c[realKey] !== null && Number.isFinite(c[realKey] as number) ? Number(c[realKey]) : null,
      pred: Math.max(0, Number(c[predKey])),
    }))
    .sort((a, b) => a.ts - b.ts);
  const realPoints = allPoints.filter((p) => p.real !== null) as Array<{ ts: number; real: number; pred: number }>;

  if (allPoints.length < 2) {
    return <div style={{ fontSize: 12, color: "var(--af-text-tertiary)" }}>No data.</div>;
  }
  // Use real-points-only for legend stats so MAE reflects actual comparison.
  const points = realPoints;

  const padX = 48;
  const padTop = 16;
  const padBottom = 32;

  const tsMin = allPoints[0]!.ts;
  const tsMax = allPoints[allPoints.length - 1]!.ts;
  const yMax = Math.max(
    100,
    ...allPoints.map((p) => Math.max(p.real ?? 0, p.pred)),
  );

  const xOf = (ts: number) =>
    padX + ((ts - tsMin) / (tsMax - tsMin)) * (width - padX * 2);
  const yOf = (v: number) =>
    padTop + (1 - v / yMax) * (height - padTop - padBottom);

  // Predicted line spans EVERYTHING (back-fill + real period). Real line
  // only spans where we have daemon data.
  const predPath = pathFrom(allPoints.map((p) => [xOf(p.ts), yOf(p.pred)] as [number, number]));
  const realPath = pathFrom(realPoints.map((p) => [xOf(p.ts), yOf(p.real)] as [number, number]));
  // Vertical divider between back-fill region and real region.
  const realStartTs = realPoints[0]?.ts ?? tsMin;
  const showBackfillDivider = realStartTs > tsMin;

  // Compute MAE for the overlay legend.
  const mae =
    points.reduce((sum, p) => sum + Math.abs(p.real - p.pred), 0) / points.length;
  const corr = pearson(
    points.map((p) => p.real),
    points.map((p) => p.pred),
  );

  // y-axis ticks at 0/25/50/75/100 (or scaled if yMax > 100)
  const ticks = [0, 25, 50, 75, 100].filter((t) => t <= yMax);
  if (yMax > 100) ticks.push(Math.round(yMax));

  // x-axis: first, middle, last
  const xLabels = [
    { ts: tsMin, label: formatDate(tsMin) },
    { ts: (tsMin + tsMax) / 2, label: formatDate((tsMin + tsMax) / 2) },
    { ts: tsMax, label: formatDate(tsMax) },
  ];

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 18,
          marginBottom: 6,
          fontSize: 12,
          color: "var(--af-text-tertiary)",
          fontFamily: "var(--font-mono)",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ display: "inline-block", width: 12, height: 2, background: "var(--af-accent)" }} />
          real (daemon)
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ display: "inline-block", width: 12, height: 2, background: "#b58400", borderTop: "1px dashed #b58400" }} />
          predicted (jsonl × calibration)
        </span>
        {showBackfillDivider && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ display: "inline-block", width: 12, height: 16, background: "rgba(180,132,0,0.07)", border: "1px dashed rgba(180,132,0,0.4)" }} />
            cold-start back-fill
          </span>
        )}
        <span style={{ marginLeft: "auto" }}>
          MAE {mae.toFixed(1)}pp · corr {corr.toFixed(2)} · n={points.length}
        </span>
      </div>
      <svg width={width} height={height} role="img" aria-label={`Real vs predicted ${window} utilization`}>
        {/* Back-fill region shading */}
        {showBackfillDivider && (
          <rect
            x={xOf(tsMin)}
            y={padTop}
            width={xOf(realStartTs) - xOf(tsMin)}
            height={height - padTop - padBottom}
            fill="rgba(180,132,0,0.06)"
          />
        )}
        {/* y grid */}
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={padX}
              x2={width - padX}
              y1={yOf(t)}
              y2={yOf(t)}
              stroke="var(--af-border-subtle)"
              strokeDasharray={t === 0 ? "0" : "2 4"}
            />
            <text
              x={padX - 8}
              y={yOf(t) + 4}
              textAnchor="end"
              fontSize={11}
              fill="var(--af-text-tertiary)"
              fontFamily="var(--font-mono)"
            >
              {t}%
            </text>
          </g>
        ))}
        {/* x labels */}
        {xLabels.map((l) => (
          <text
            key={l.ts}
            x={xOf(l.ts)}
            y={height - 8}
            textAnchor="middle"
            fontSize={11}
            fill="var(--af-text-tertiary)"
            fontFamily="var(--font-mono)"
          >
            {l.label}
          </text>
        ))}
        {/* predicted (drawn first so real is on top) */}
        <path
          d={predPath}
          fill="none"
          stroke="#b58400"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeDasharray="4 3"
        />
        {/* real */}
        <path
          d={realPath}
          fill="none"
          stroke="var(--af-accent)"
          strokeWidth={1.6}
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function pathFrom(points: [number, number][]): string {
  return points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  if (n === 0) return 0;
  const meanA = a.reduce((s, x) => s + x, 0) / n;
  const meanB = b.reduce((s, x) => s + x, 0) / n;
  let num = 0;
  let denomA = 0;
  let denomB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i]! - meanA;
    const db = b[i]! - meanB;
    num += da * db;
    denomA += da * da;
    denomB += db * db;
  }
  const denom = Math.sqrt(denomA * denomB);
  return denom === 0 ? 0 : num / denom;
}
