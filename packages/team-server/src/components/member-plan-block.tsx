import { tierEntry } from "../lib/plan-tiers";
import { UtilizationSparkline } from "./utilization-sparkline";
import type { MemberPlanSummary } from "../lib/plan-queries";

export function MemberPlanBlock({ summary }: { summary: MemberPlanSummary }) {
  const tier = tierEntry(summary.planTier);

  return (
    <>
      <div className="subsection-head">
        <h2>Plan utilization</h2>
        <span className="kicker">30-day window · per-member</span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 16,
          marginBottom: 18,
        }}
      >
        <Stat
          label="Plan tier"
          value={
            tier.weeklyLimitUsd > 0
              ? `${tier.label} · $${tier.weeklyLimitUsd}/wk`
              : tier.label
          }
        />
        <Stat label="7d avg" value={`${summary.avgSevenDayPct.toFixed(0)}%`} />
        <Stat label="7d peak" value={`${summary.worstSevenDayPeak.toFixed(0)}%`} />
        <Stat label="5h peak" value={`${summary.worstFiveHourPeak.toFixed(0)}%`} />
        <Stat
          label="Days observed"
          value={`${summary.totalDaysObserved} / 30`}
        />
        <Stat
          label="Last snapshot"
          value={
            summary.lastSeenAtMs != null
              ? new Date(summary.lastSeenAtMs).toLocaleString()
              : "—"
          }
        />
      </div>

      <div style={{ marginBottom: 24 }}>
        <div
          className="mono"
          style={{
            fontSize: 11,
            letterSpacing: "0.1em",
            color: "var(--mute)",
            textTransform: "uppercase",
            marginBottom: 8,
          }}
        >
          12-week peak trail
        </div>
        <UtilizationSparkline values={summary.trail} width={240} height={48} />
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        className="mono"
        style={{
          fontSize: 11,
          letterSpacing: "0.1em",
          color: "var(--mute)",
          textTransform: "uppercase",
        }}
      >
        {label}
      </div>
      <div
        className="mono"
        style={{ fontSize: 16, marginTop: 4, color: "var(--ink)" }}
      >
        {value}
      </div>
    </div>
  );
}
