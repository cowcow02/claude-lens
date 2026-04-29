type BurndownLevel = "red" | "yellow" | "info";

type Props = {
  burndown: {
    level: BurndownLevel;
    message: string | null;
    currentSpendUsd: number;
    capUsd: number;
    projectedEndOfWindowUsd: number | null;
    avgWindowFractionElapsed: number;
    approxDaysRemaining: number | null;
    topContributors: { memberName: string; contributionUsd: number; tierLabel: string }[];
  };
};

const TONE: Record<BurndownLevel, string> = {
  red: "#a93b2c",
  yellow: "#b58400",
  info: "var(--mute)",
};

const TONE_LABEL: Record<BurndownLevel, string> = {
  red: "Throttling risk",
  yellow: "Approaching cap",
  info: "Healthy",
};

export function BurndownCard({ burndown: b }: Props) {
  const headlineColor = TONE[b.level];
  return (
    <section
      className="settings-section"
      style={{ borderLeft: `3px solid ${headlineColor}` }}
    >
      <div className="subsection-head">
        <h2>Capacity burndown</h2>
        <span className="kicker" style={{ color: headlineColor }}>
          {TONE_LABEL[b.level]}
        </span>
      </div>

      {b.capUsd === 0 ? (
        <div style={{ color: "var(--mute)", fontSize: 13, padding: "12px 0" }}>
          No fresh snapshots in the last hour. Live capacity unknown until daemons push.
        </div>
      ) : (
        <>
          {b.message && (
            <p style={{ marginTop: 0, marginBottom: 14 }}>{b.message}</p>
          )}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: 16,
              marginBottom: 14,
            }}
          >
            <Stat
              label="Run-rate"
              value={`$${b.currentSpendUsd.toFixed(0)}/mo`}
              hint="Current usage × plan price — what this team is on track to consume monthly"
            />
            <Stat
              label="Projected end-of-window"
              value={
                b.projectedEndOfWindowUsd != null
                  ? `$${b.projectedEndOfWindowUsd.toFixed(0)}/mo`
                  : "—"
              }
              hint="Where the run-rate lands by the end of the current 7-day window"
            />
            <Stat
              label="Plan total"
              value={`$${b.capUsd.toFixed(0)}/mo`}
              hint="Sum of every member's monthly subscription cost"
            />
            <Stat
              label="Window resets in"
              value={
                b.approxDaysRemaining != null
                  ? `${b.approxDaysRemaining.toFixed(1)} days`
                  : "—"
              }
              hint="Average across members of their rolling 7-day windows"
            />
          </div>

          {b.topContributors.length > 0 && (
            <table className="data" style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>Top contributors</th>
                  <th>Plan</th>
                  <th>Run-rate</th>
                </tr>
              </thead>
              <tbody>
                {b.topContributors.map((c) => (
                  <tr key={c.memberName}>
                    <td>{c.memberName}</td>
                    <td className="mono" style={{ fontSize: 12, color: "var(--mute)" }}>
                      {c.tierLabel}
                    </td>
                    <td className="mono">${c.contributionUsd.toFixed(0)}/mo</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div
            className="mono"
            style={{ fontSize: 11, color: "var(--mute)", marginTop: 14 }}
          >
            Run-rate is each member&rsquo;s 7-day utilization × their monthly plan
            price. Projections average across members&rsquo; rolling windows;
            actual end-of-window may differ.
          </div>
        </>
      )}
    </section>
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
      <div className="mono" style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>
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
