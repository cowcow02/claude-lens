// Lightweight inline sparkline. No chart library — the team-server bundle
// stays slim and the line lives inside table cells without alignment fights.
type Props = {
  values: number[]; // each in 0-100
  width?: number;
  height?: number;
};

export function UtilizationSparkline({ values, width = 120, height = 30 }: Props) {
  if (values.length === 0) {
    return (
      <span className="mono" style={{ fontSize: 11, color: "var(--mute)" }}>
        no data
      </span>
    );
  }
  if (values.length === 1) {
    const v = clamp(values[0]!, 0, 100);
    return (
      <span className="mono" style={{ fontSize: 11, color: "var(--mute)" }}>
        {v.toFixed(0)}%
      </span>
    );
  }
  const padX = 2;
  const padY = 2;
  const xStep = (width - padX * 2) / (values.length - 1);
  const points = values
    .map((v, i) => {
      const x = padX + i * xStep;
      const y = padY + (height - padY * 2) * (1 - clamp(v, 0, 100) / 100);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const last = values[values.length - 1]!;
  const peak = Math.max(...values);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <svg width={width} height={height} role="img" aria-label={`utilization sparkline, peak ${peak.toFixed(0)}%, latest ${last.toFixed(0)}%`}>
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <span className="mono" style={{ fontSize: 11, color: "var(--mute)" }}>
        peak {peak.toFixed(0)}%
      </span>
    </span>
  );
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
