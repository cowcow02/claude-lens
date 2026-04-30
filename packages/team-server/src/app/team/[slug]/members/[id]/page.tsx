import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPool } from "../../../../../db/pool";
import { validateSession } from "../../../../../lib/auth";
import { loadMember, loadMemberRollups } from "../../../../../lib/queries";
import { loadMemberPlanSummary, loadMembership7dCyclePeaks } from "../../../../../lib/plan-queries";
import { tierEntry } from "../../../../../lib/plan-tiers";
import { formatAgentTime, formatTokens } from "../../../../../lib/format";
import { MemberProfile } from "../../../../../components/member-profile";
import { MemberPlanBlock } from "../../../../../components/member-plan-block";

export default async function MemberPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const pool = getPool();

  const cookieStore = await cookies();
  const token = cookieStore.get("fleetlens_session")?.value;
  const session = token ? await validateSession(token, pool) : null;
  if (!session) redirect("/login");

  const member = await loadMember(id, pool);
  if (!member) return <div>Member not found.</div>;

  const myMembership = session.memberships.find((m) => m.team_id === member.team_id);
  if (!myMembership) redirect("/login");

  const isSelf = myMembership.id === id;
  if (myMembership.role !== "admin" && !isSelf) {
    return (
      <div className="section-head">
        <div>
          <h1>Not <em>authorized</em></h1>
          <div className="kicker" style={{ marginTop: 8 }}>
            You can only view your own profile on this team.
          </div>
        </div>
      </div>
    );
  }

  const [rollups, planSummary, allCyclePeaks] = await Promise.all([
    loadMemberRollups(member.team_id, id, 30, pool),
    loadMemberPlanSummary(member.team_id, id, pool),
    loadMembership7dCyclePeaks(member.team_id, pool),
  ]);
  const cyclePeaks = allCyclePeaks.get(id) ?? [];
  const canSeeRoster = myMembership.role === "admin";

  // 30-day rollup totals — surfaced inline in the header card so admins
  // don't have to scroll to find "is this seat actually being used?"
  const totalAgentMs = rollups.reduce((s, r) => s + Number(r.agent_time_ms), 0);
  const totalSessions = rollups.reduce((s, r) => s + r.sessions, 0);
  const totalTokens = rollups.reduce(
    (s, r) =>
      s +
      Number(r.tokens_input) +
      Number(r.tokens_output) +
      Number(r.tokens_cache_read) +
      Number(r.tokens_cache_write),
    0,
  );
  const tier = tierEntry(planSummary.planTier);

  return (
    <>
      {canSeeRoster ? (
        <a
          href={`/team/${slug}`}
          className="kicker"
          style={{ display: "inline-block", marginBottom: 18, color: "var(--mute)" }}
        >
          ← Back to roster
        </a>
      ) : (
        <div
          className="kicker"
          style={{ display: "inline-block", marginBottom: 18, color: "var(--mute)" }}
        >
          Your profile
        </div>
      )}

      {/* ─── 1. WHO + STATUS HEADER ─────────────────────────────────── */}
      {/* Identity, plan, daemon freshness, and 30-day engagement
          consolidated into one banner. Admins see everything they need
          to "place" this seat without scanning multiple sections. */}
      <header
        style={{
          padding: "20px 22px",
          background: "var(--paper)",
          border: "1px solid var(--rule)",
          marginBottom: 18,
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 24,
            flexWrap: "wrap",
          }}
        >
          <div>
            <h1 className="profile-name" style={{ margin: 0 }}>
              <em>{member.display_name || member.email || "Anonymous"}</em>
            </h1>
            {member.email && (
              <div
                className="mono"
                style={{ marginTop: 6, fontSize: 12, color: "var(--mute)" }}
              >
                {member.email}
              </div>
            )}
          </div>
          <div
            className="profile-meta"
            style={{ textAlign: "right", whiteSpace: "nowrap" }}
          >
            {member.role.toUpperCase()}
            <br />
            JOINED{" "}
            {new Date(member.joined_at)
              .toLocaleDateString("en-US", {
                month: "short",
                day: "2-digit",
                year: "numeric",
              })
              .toUpperCase()}
          </div>
        </div>

        <div
          style={{
            borderTop: "1px solid var(--rule)",
            paddingTop: 14,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 18,
            fontSize: 12,
          }}
        >
          <HeaderField
            label="Plan"
            value={
              tier.monthlyPriceUsd > 0
                ? `${tier.label} · $${tier.monthlyPriceUsd}/mo`
                : tier.label
            }
          />
          <HeaderField label="Daemon" value={daemonFreshness(planSummary.lastSeenAtMs)} />
          <HeaderField
            label="30-day engagement"
            value={`${planSummary.totalDaysObserved} active days`}
          />
          <HeaderField label="30-day agent time" value={formatAgentTime(totalAgentMs)} />
          <HeaderField label="30-day sessions" value={String(totalSessions)} />
          <HeaderField label="30-day tokens" value={formatTokens(totalTokens)} />
        </div>
      </header>

      {/* ─── 2. PLAN MATCH (verdict + cycle trend + throttling) ─────── */}
      <MemberPlanBlock summary={planSummary} cyclePeaks={cyclePeaks} />

      {/* ─── 3. DAILY ACTIVITY (per-day shape + drill-down table) ───── */}
      <MemberProfile rollups={rollups} />
    </>
  );
}

function HeaderField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        className="mono"
        style={{
          fontSize: 10,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--mute)",
        }}
      >
        {label}
      </div>
      <div className="mono" style={{ fontSize: 14, marginTop: 3, color: "var(--ink)" }}>
        {value}
      </div>
    </div>
  );
}

// Mirrors the helper in member-plan-block.tsx; duplicated here so the
// header doesn't have to import an internal helper. Both renderers
// agree on the same buckets ("live" within 10 min of last poll, etc).
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
