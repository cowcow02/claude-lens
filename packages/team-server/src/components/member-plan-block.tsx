import { tierEntry } from "../lib/plan-tiers";
import type { Recommendation } from "../lib/plan-optimizer";
import { UtilizationSparkline } from "./utilization-sparkline";
import { CyclePeaksStrip } from "./cycle-peaks-strip";
import type { MemberPlanSummary, MembershipCyclePeak } from "../lib/plan-queries";

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

export function MemberPlanBlock({
  summary,
  cyclePeaks = [],
}: {
  summary: MemberPlanSummary;
  cyclePeaks?: MembershipCyclePeak[];
}) {
  const tier = tierEntry(summary.planTier);
  const tone = ACTION_TONE[summary.recommendation.action];

  // Most recently completed cycle (drops the in-progress one). Used to
  // render the "Last cycle" callout that mirrors the personal edition's
  // headline number on the trend strip.
  const completed = cyclePeaks.filter((c) => !c.isCurrent);
  const lastCompleted = completed.length > 0 ? completed[completed.length - 1] : null;
  const trendDelta = (() => {
    if (completed.length < 2) return null;
    const last = completed[completed.length - 1]!.peakPct;
    const prev = completed[completed.length - 2]!.peakPct;
    return last - prev;
  })();
  const currentInFlight = cyclePeaks.find((c) => c.isCurrent) ?? null;

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

      {/* Three tiles only — what admins actually need to make a tier
          decision. We dropped "avg utilization" (lossy 30-day mean —
          the cycle bars below show real per-cycle behaviour), "peak 7d"
          (identical to the tallest cycle bar) and "peak 5h" (subsumed
          by the wall-hits panel which is the actionable version). */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
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
          label="Active days"
          value={`${summary.totalDaysObserved} of 30`}
          hint="How engaged this seat is — flags wasted licenses on quiet members"
        />
        <Stat
          label="Daemon"
          value={daemonFreshness(summary.lastSeenAtMs)}
          hint="If this isn't recent, the rest of this card may be stale"
        />
      </div>

      {/* Throttling counters. "100% peak" looks alarming on its own —
          this panel turns it into "did they actually hit the wall, and
          for how many days?" Anthropic stops accepting new work once a
          rolling window hits its cap, so these days are when the user
          was *blocked* (or routed to a slower model), not just busy. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: 16,
          marginBottom: 24,
          padding: "14px 16px",
          background: "var(--paper)",
          border: "1px solid var(--rule)",
        }}
      >
        <WallStat
          label="Throttled (weekly limit)"
          count={summary.wallHits7d}
          hint="Days they exhausted the rolling 7-day budget — Claude refuses or routes to a fallback until the window rolls forward"
        />
        <WallStat
          label="Throttled (5-hour burst)"
          count={summary.wallHits5h}
          hint="Days a 5-hour burst hit 100% — bursty work, mid-session throttling that resolves on the next 5-hour reset"
        />
      </div>

      {/* Per-cycle peak history — same data and visual the member sees on
          their personal /usage page. Bars are ordered oldest → newest;
          height = peak utilization, color follows danger thresholds,
          striped = predicted from JSONL (cold-start), dashed border = the
          in-progress cycle. Hover any bar for exact date + source. */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 14,
            flexWrap: "wrap",
            marginBottom: 10,
          }}
        >
          <div
            className="mono"
            style={{
              fontSize: 11,
              letterSpacing: "0.1em",
              color: "var(--mute)",
              textTransform: "uppercase",
            }}
          >
            Previous 7d cycles
          </div>
          {lastCompleted && (
            <div style={{ fontSize: 12, color: "var(--ink)" }}>
              <span style={{ color: "var(--mute)" }}>last cycle peak:</span>{" "}
              <strong style={{ color: peakColor(lastCompleted.peakPct) }}>
                {lastCompleted.peakPct.toFixed(0)}%
              </strong>
              {trendDelta !== null && Math.abs(trendDelta) >= 5 && (
                <span style={{ marginLeft: 8, color: "var(--mute)" }}>
                  · {trendDelta > 0 ? "↑" : "↓"}{" "}
                  {Math.abs(trendDelta).toFixed(0)}pp from prior
                </span>
              )}
              {trendDelta !== null && Math.abs(trendDelta) < 5 && (
                <span style={{ marginLeft: 8, color: "var(--mute)" }}>
                  · flat vs prior
                </span>
              )}
            </div>
          )}
          {currentInFlight && (
            <div
              style={{
                marginLeft: "auto",
                fontSize: 12,
                color: "var(--ink)",
              }}
            >
              <span style={{ color: "var(--mute)" }}>in progress:</span>{" "}
              <strong style={{ color: peakColor(currentInFlight.peakPct) }}>
                {currentInFlight.peakPct.toFixed(0)}%
              </strong>
            </div>
          )}
        </div>
        {cyclePeaks.length > 0 ? (
          <CyclePeaksStrip cycles={cyclePeaks} maxBars={12} />
        ) : (
          // Fall back to the legacy mat-view sparkline when no cycle-peak
          // data has been pushed yet (daemon predates the cyclePeaks wire
          // field, or the membership is brand new).
          <div>
            <div style={{ fontSize: 11, color: "var(--mute)", marginBottom: 6 }}>
              No cycle-peak data yet · showing legacy weekly trail
            </div>
            <UtilizationSparkline values={summary.trail} width={240} height={48} />
          </div>
        )}
        <div
          style={{
            fontSize: 11,
            color: "var(--mute)",
            marginTop: 8,
            fontStyle: "italic",
          }}
        >
          Striped bars = estimated from local JSONL spend (cold-start).
          Solid bars = measured from daemon. Dashed border = in-progress cycle.
          Hover for exact date.
        </div>
      </div>
    </>
  );
}

// Same color scale used inside CyclePeaksStrip so the callout numbers
// match what the bars show.
function peakColor(pct: number): string {
  if (pct >= 90) return "#c5283d";
  if (pct >= 70) return "#b58400";
  return "#2f8f5a";
}

// "5m ago" / "2h ago" / "yesterday" — relative format an admin can scan.
// "live" if the daemon polled in the last 10 min (matches the daemon's
// 5-min interval + a buffer for clock skew).
function daemonFreshness(lastSeenAtMs: number | null): string {
  if (lastSeenAtMs == null) return "—";
  const ageMs = Date.now() - lastSeenAtMs;
  if (ageMs < 0) return "just now";
  if (ageMs < 10 * 60 * 1000) return "live · last poll just now";
  if (ageMs < 60 * 60 * 1000) return `${Math.round(ageMs / 60_000)}m ago`;
  if (ageMs < 24 * 60 * 60 * 1000) return `${Math.round(ageMs / 3_600_000)}h ago`;
  if (ageMs < 7 * 86_400_000) return `${Math.round(ageMs / 86_400_000)}d ago — daemon stalled?`;
  return `${Math.round(ageMs / 86_400_000)}d ago — daemon down`;
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
        {count === 0
          ? "Never · 0 / 30 days"
          : `${count} / 30 day${count === 1 ? "" : "s"}`}
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
