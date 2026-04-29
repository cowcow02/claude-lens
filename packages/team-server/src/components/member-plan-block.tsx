import { tierEntry } from "../lib/plan-tiers";
import type { Recommendation } from "../lib/plan-optimizer";
import { UtilizationSparkline } from "./utilization-sparkline";
import type { MemberPlanSummary } from "../lib/plan-queries";

const ACTION_LABEL: Record<Recommendation["action"], string> = {
  insufficient_data: "Collecting data",
  review_manually: "Review manually",
  top_up_needed: "Hitting the wall",
  upgrade_urgent: "Upgrade urgent",
  upgrade: "Upgrade suggested",
  downgrade: "Downgrade candidate",
  stay: "Plan well-matched",
};

type Tone = "good" | "warn" | "danger" | "info";

const ACTION_TONE: Record<Recommendation["action"], Tone> = {
  insufficient_data: "info",
  review_manually: "info",
  top_up_needed: "danger",
  upgrade_urgent: "danger",
  upgrade: "warn",
  downgrade: "good",
  stay: "good",
};

export function MemberPlanBlock({ summary }: { summary: MemberPlanSummary }) {
  const tier = tierEntry(summary.planTier);
  const tone = ACTION_TONE[summary.recommendation.action];

  return (
    <>
      <div className="subsection-head">
        <h2>Subscription utilization</h2>
        <span className="kicker">last 30 days · how well this seat uses its plan</span>
      </div>

      {/* Verdict banner — the answer to "is this plan right for them" */}
      <div
        style={{
          background: "var(--paper)",
          border: "1px solid var(--rule)",
          borderLeft: `3px solid ${toneColor(tone)}`,
          padding: "14px 18px",
          marginBottom: 18,
        }}
      >
        <div
          className="mono"
          style={{
            fontSize: 11,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: toneColor(tone),
            fontWeight: 600,
          }}
        >
          {ACTION_LABEL[summary.recommendation.action]}
          {"confidence" in summary.recommendation && (
            <span style={{ color: "var(--mute)", marginLeft: 8, fontWeight: 400 }}>
              · {summary.recommendation.confidence} confidence
            </span>
          )}
        </div>
        <div style={{ fontSize: 14, marginTop: 6, color: "var(--ink)" }}>
          {summary.recommendation.rationale}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 16,
          marginBottom: 18,
        }}
      >
        <Stat
          label="Plan"
          value={
            tier.monthlyPriceUsd > 0
              ? `${tier.label} · $${tier.monthlyPriceUsd}/mo`
              : tier.label
          }
          hint="Anthropic subscription tier set for this seat"
        />
        <Stat
          label="Avg utilization"
          value={`${summary.avgSevenDayPct.toFixed(0)}%`}
          hint="Average rolling 7-day usage across the window"
        />
        <Stat
          label="Peak 7-day"
          value={`${summary.worstSevenDayPeak.toFixed(0)}%`}
          hint="Worst 7-day window seen"
        />
        <Stat
          label="Peak 5-hour"
          value={`${summary.worstFiveHourPeak.toFixed(0)}%`}
          hint="Worst 5-hour burst seen"
        />
        <Stat
          label="Active days"
          value={`${summary.totalDaysObserved} of 30`}
          hint="Days the daemon recorded any usage"
        />
        <Stat
          label="Last snapshot"
          value={
            summary.lastSeenAtMs != null
              ? new Date(summary.lastSeenAtMs).toLocaleString()
              : "—"
          }
          hint="Most recent push from this seat's daemon"
        />
      </div>

      {/* Wall hits — turns "100% peak" into "but did they actually hit the cap?" */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 16,
          marginBottom: 24,
          padding: "14px 16px",
          background: "var(--paper)",
          border: "1px solid var(--rule)",
        }}
      >
        <WallStat
          label="Days at the 7-day cap"
          count={summary.wallHits7d}
          hint="Distinct days where the rolling 7-day usage reached 100%"
        />
        <WallStat
          label="Days at the 5-hour cap"
          count={summary.wallHits5h}
          hint="Distinct days a 5-hour burst hit 100% — bursty work, throttling risk"
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
          Past 12 weeks · weekly peak utilization
        </div>
        <UtilizationSparkline values={summary.trail} width={240} height={48} />
      </div>
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
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
      {hint && (
        <div style={{ fontSize: 11, marginTop: 4, color: "var(--mute)", lineHeight: 1.4 }}>
          {hint}
        </div>
      )}
    </div>
  );
}

function WallStat({ label, count, hint }: { label: string; count: number; hint: string }) {
  const tone: Tone = count === 0 ? "good" : count >= 3 ? "danger" : "warn";
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
        style={{ fontSize: 18, marginTop: 4, color: toneColor(tone), fontWeight: 600 }}
      >
        {count === 0 ? "0 days" : `${count} day${count === 1 ? "" : "s"}`}
      </div>
      <div style={{ fontSize: 11, marginTop: 4, color: "var(--mute)", lineHeight: 1.4 }}>
        {hint}
      </div>
    </div>
  );
}

function toneColor(tone: Tone): string {
  switch (tone) {
    case "danger":
      return "#a93b2c";
    case "warn":
      return "#b58400";
    case "good":
      return "#2c6e49";
    case "info":
      return "var(--mute)";
  }
}
