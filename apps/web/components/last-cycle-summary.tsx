import type { LastCycleSummary } from "@/lib/calibration-data";

// Small row that surfaces the most recently completed cycle's peak
// utilization for both 5h and 7d windows, each tagged with its data
// source (real-from-daemon vs JSONL-predicted). Designed to be reusable
// on the team-edition member page so admins can see the same number
// without re-rendering the full chart.
export function LastCycleSummary({
  fiveHour,
  sevenDay,
}: {
  fiveHour: LastCycleSummary | null;
  sevenDay: LastCycleSummary | null;
}) {
  if (!fiveHour && !sevenDay) return null;
  return (
    <section
      style={{
        display: "flex",
        gap: 12,
        flexWrap: "wrap",
        fontSize: 12,
        fontFamily: "var(--font-mono)",
      }}
    >
      {sevenDay && <SummaryPill summary={sevenDay} />}
      {fiveHour && <SummaryPill summary={fiveHour} />}
    </section>
  );
}

function SummaryPill({ summary }: { summary: LastCycleSummary }) {
  const tone = summary.source === "real"
    ? { fg: "var(--af-text)", border: "var(--af-border-subtle)", bg: "transparent" }
    : { fg: "#b58400", border: "rgba(180,132,0,0.4)", bg: "rgba(180,132,0,0.06)" };
  // Color the peak number red/amber/green by absolute level — same buckets
  // we use elsewhere on the burndown charts so the team-edition card can
  // share visual language.
  const peakColor =
    summary.peakPct >= 90 ? "var(--af-danger)" :
    summary.peakPct >= 70 ? "#b58400" :
    "var(--af-success)";
  const ended = formatRelativeDate(summary.endsAt);
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        border: `1px solid ${tone.border}`,
        background: tone.bg,
        borderRadius: 8,
        color: tone.fg,
      }}
      title={`Cycle ${summary.startedAt.slice(0, 10)} → ${summary.endsAt.slice(0, 10)}`}
    >
      <span style={{ color: "var(--af-text-tertiary)", letterSpacing: "0.04em", textTransform: "uppercase", fontSize: 10 }}>
        last {summary.windowLabel} cycle peak
      </span>
      <span style={{ fontWeight: 700, fontSize: 14, color: peakColor }}>
        {summary.peakPct.toFixed(1)}%
      </span>
      <span style={{ color: "var(--af-text-tertiary)" }}>
        · {summary.source === "real" ? "measured" : "estimated"} · {ended}
      </span>
    </div>
  );
}

function formatRelativeDate(iso: string): string {
  const t = new Date(iso).getTime();
  const dayMs = 86_400_000;
  const days = Math.floor((Date.now() - t) / dayMs);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
