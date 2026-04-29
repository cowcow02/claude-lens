import { cookies } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { getPool } from "../../../../db/pool";
import { validateSession } from "../../../../lib/auth";
import {
  loadOptimizerInputs,
  loadOptimizerSettings,
  loadLatestSnapshotsPerMember,
  loadMembershipSparklines,
  loadMembership7dCyclePeaks,
} from "../../../../lib/plan-queries";
import { recommend } from "../../../../lib/plan-optimizer";
import { tierEntry } from "../../../../lib/plan-tiers";
import { computeBurndown } from "../../../../lib/capacity-burndown";
import { OptimizerCard } from "../../../../components/optimizer-card";
import { BurndownCard } from "../../../../components/burndown-card";
import { UtilizationSparkline } from "../../../../components/utilization-sparkline";
import { CyclePeaksStrip } from "../../../../components/cycle-peaks-strip";
import { PlanTuningForm } from "../../../../components/plan-tuning-form";

export default async function PlanPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const pool = getPool();

  const cookieStore = await cookies();
  const token = cookieStore.get("fleetlens_session")?.value;
  const session = token ? await validateSession(token, pool) : null;
  if (!session) redirect("/login");

  const teamRes = await pool.query("SELECT id, name FROM teams WHERE slug = $1", [slug]);
  if (!teamRes.rowCount) notFound();
  const team = teamRes.rows[0];

  const myMembership = session.memberships.find((m) => m.team_id === team.id);
  if (!myMembership) redirect("/login");
  if (myMembership.role !== "admin") {
    return (
      <div className="section-head">
        <div>
          <h1>Admin <em>only</em></h1>
          <div className="kicker" style={{ marginTop: 8 }}>
            The Plan view is visible to admins only.
          </div>
        </div>
      </div>
    );
  }

  const [inputs, settings, snapshots, sparklines, cyclePeaks] = await Promise.all([
    loadOptimizerInputs(team.id, pool),
    loadOptimizerSettings(team.id, pool),
    loadLatestSnapshotsPerMember(team.id, pool),
    loadMembershipSparklines(team.id, pool),
    loadMembership7dCyclePeaks(team.id, pool),
  ]);

  const recommendations = inputs.map((i) => {
    const tier = tierEntry(i.tierKey);
    return {
      input: i,
      tier,
      recommendation: recommend(i.stats, tier, settings),
    };
  });

  const burndown = computeBurndown(snapshots);

  // Bottom-line: net monthly $ delta if every recommendation were applied.
  let monthlyDelta = 0;
  let countUpgrade = 0;
  let countDowngrade = 0;
  let countCustom = 0;
  let countInsufficient = 0;
  for (const r of recommendations) {
    const a = r.recommendation.action;
    if (a === "upgrade" || a === "upgrade_urgent") countUpgrade++;
    if (a === "downgrade") {
      countDowngrade++;
      monthlyDelta -= r.recommendation.estimatedSavingsUsd;
    }
    if (a === "review_manually") countCustom++;
    if (a === "insufficient_data") countInsufficient++;
  }

  const customCount = recommendations.filter(
    (r) => r.input.tierKey === "custom",
  ).length;

  return (
    <>
      <div className="section-head">
        <div>
          <h1>The <em>Plan</em></h1>
          <div className="kicker" style={{ marginTop: 8 }}>
            Plan utilization · {recommendations.length} active{" "}
            {recommendations.length === 1 ? "member" : "members"}
          </div>
        </div>
        <div className="kicker">
          {monthlyDelta < 0 && `~$${Math.round(-monthlyDelta)}/mo savings available`}
          {monthlyDelta === 0 && "No optimizer-suggested changes"}
          {monthlyDelta > 0 && `~$${Math.round(monthlyDelta)}/mo additional spend if upgrades applied`}
        </div>
      </div>

      <section className="settings-section">
        <div className="subsection-head">
          <h2>Summary</h2>
          <span className="kicker">30-day window · last refresh hourly</span>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 16,
          }}
        >
          <SummaryStat label="Upgrade" value={countUpgrade} />
          <SummaryStat label="Downgrade" value={countDowngrade} />
          <SummaryStat label="Custom tier" value={countCustom} />
          <SummaryStat label="Collecting data" value={countInsufficient} />
          <SummaryStat
            label="Net Δ / mo"
            value={
              monthlyDelta === 0
                ? "$0"
                : `${monthlyDelta < 0 ? "-" : "+"}$${Math.abs(Math.round(monthlyDelta))}`
            }
          />
        </div>
      </section>

      <BurndownCard burndown={burndown} />

      <section className="settings-section">
        <div className="subsection-head">
          <h2>Per-member recommendations</h2>
          <span className="kicker">Acknowledge = noted; plan changes happen via Anthropic billing</span>
        </div>
        {recommendations.length === 0 ? (
          <p style={{ color: "var(--mute)", fontSize: 13 }}>No active members.</p>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: 16,
            }}
          >
            {recommendations.map(({ input, tier, recommendation }) => (
              <OptimizerCard
                key={input.membershipId}
                membershipId={input.membershipId}
                memberName={input.memberName}
                memberEmail={input.memberEmail}
                currentPlan={{
                  key: tier.key,
                  label: tier.label,
                  monthlyPriceUsd: tier.monthlyPriceUsd,
                }}
                usage={{
                  avgSevenDayPct: input.stats.avgSevenDayAvg,
                  worstSevenDayPeak: input.stats.worstSevenDayPeak,
                  worstFiveHourPeak: input.stats.worstFiveHourPeak,
                  worstOpusPeak: input.stats.worstOpusPeak,
                  totalDaysObserved: input.stats.totalDaysObserved,
                  lastSeen:
                    input.stats.lastSeenAtMs != null
                      ? new Date(input.stats.lastSeenAtMs).toISOString()
                      : null,
                }}
                recommendation={recommendation}
              />
            ))}
          </div>
        )}
      </section>

      {customCount > 0 && (
        <section className="settings-section">
          <p
            style={{
              padding: "10px 14px",
              border: "1px solid var(--rule)",
              borderLeft: "3px solid #b58400",
              background: "var(--paper)",
              margin: 0,
            }}
          >
            <strong>{customCount}</strong>{" "}
            {customCount === 1 ? "member is" : "members are"} on a{" "}
            <em>custom</em> tier — recommendations are manual for these.
          </p>
        </section>
      )}

      <section className="settings-section">
        <div className="subsection-head">
          <h2>Previous cycles</h2>
          <span className="kicker">
            Per-member 7d peak utilization · oldest → newest · same data the
            personal /usage page shows
          </span>
        </div>
        <table className="member-table">
          <thead>
            <tr>
              <th>Member</th>
              <th>Plan</th>
              <th style={{ minWidth: 320 }}>Last cycles</th>
            </tr>
          </thead>
          <tbody>
            {recommendations.map(({ input, tier }) => {
              const peaks = cyclePeaks.get(input.membershipId) ?? [];
              return (
                <tr key={input.membershipId}>
                  <td>{input.memberName}</td>
                  <td className="mono" style={{ fontSize: 12, color: "var(--mute)" }}>
                    {tier.label}
                  </td>
                  <td>
                    {peaks.length > 0 ? (
                      <CyclePeaksStrip cycles={peaks} maxBars={8} />
                    ) : (
                      <UtilizationSparkline
                        values={sparklines.get(input.membershipId) ?? []}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p style={{ fontSize: 11, color: "var(--mute)", marginTop: 8, fontStyle: "italic" }}>
          Bars with a striped fill are estimated from local JSONL spend (cold-start, before daemon coverage).
          Solid fills are measured from daemon snapshots. The dashed-border bar on the right is the in-progress cycle.
        </p>
      </section>

      <section className="settings-section">
        <details>
          <summary className="subsection-head" style={{ cursor: "pointer" }}>
            <h2 style={{ display: "inline" }}>Tuning</h2>
            <span className="kicker"> · Threshold sliders</span>
          </summary>
          <div style={{ marginTop: 14 }}>
            <PlanTuningForm teamSlug={slug} settings={settings} />
          </div>
        </details>
      </section>
    </>
  );
}

function SummaryStat({ label, value }: { label: string; value: number | string }) {
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
      <div className="mono" style={{ fontSize: 20, fontWeight: 600, marginTop: 4 }}>
        {value}
      </div>
    </div>
  );
}
