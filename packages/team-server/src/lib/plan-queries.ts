import type pg from "pg";
import {
  DEFAULT_OPTIMIZER_SETTINGS,
  type MemberStats,
  type OptimizerSettings,
} from "./plan-optimizer";
import type { MemberLatestSnapshot } from "./capacity-burndown";
import type { PlanTierKey } from "./plan-tiers";

export type OptimizerMemberInput = {
  membershipId: string;
  memberName: string;
  memberEmail: string | null;
  tierKey: PlanTierKey;
  stats: MemberStats;
};

const OPTIMIZER_LOOKBACK_DAYS = 30;
const BURNDOWN_LATEST_WINDOW_HOURS = 1;

export async function loadOptimizerInputs(
  teamId: string,
  pool: pg.Pool,
): Promise<OptimizerMemberInput[]> {
  const res = await pool.query(`
    WITH agg AS (
      SELECT
        membership_id,
        MAX(peak_seven_day_pct)::float8     AS worst_7day_peak,
        AVG(avg_seven_day_pct)::float8      AS avg_7day_avg,
        MAX(peak_five_hour_pct)::float8     AS worst_5hr_peak,
        MAX(peak_opus_pct)::float8          AS worst_opus_peak,
        SUM(distinct_days_observed)::int    AS total_days_observed,
        EXTRACT(EPOCH FROM MAX(last_captured_at))::float8 * 1000 AS last_seen_ms
      FROM membership_weekly_utilization
      WHERE team_id = $1
        AND window_end >= now() - make_interval(days => $2::int)
      GROUP BY membership_id
    )
    SELECT
      m.id                       AS membership_id,
      COALESCE(u.display_name, u.email) AS member_name,
      u.email                    AS member_email,
      m.plan_tier                AS tier_key,
      COALESCE(a.worst_7day_peak, 0)     AS worst_7day_peak,
      COALESCE(a.avg_7day_avg, 0)        AS avg_7day_avg,
      COALESCE(a.worst_5hr_peak, 0)      AS worst_5hr_peak,
      COALESCE(a.worst_opus_peak, 0)     AS worst_opus_peak,
      COALESCE(a.total_days_observed, 0) AS total_days_observed,
      a.last_seen_ms             AS last_seen_ms
    FROM memberships m
    JOIN user_accounts u ON u.id = m.user_account_id
    LEFT JOIN agg a ON a.membership_id = m.id
    WHERE m.team_id = $1 AND m.revoked_at IS NULL
    ORDER BY m.joined_at ASC
  `, [teamId, OPTIMIZER_LOOKBACK_DAYS]);

  return res.rows.map((r) => ({
    membershipId: r.membership_id,
    memberName: r.member_name ?? "(unnamed)",
    memberEmail: r.member_email,
    tierKey: r.tier_key as PlanTierKey,
    stats: {
      worstSevenDayPeak: Number(r.worst_7day_peak),
      avgSevenDayAvg: Number(r.avg_7day_avg),
      worstFiveHourPeak: Number(r.worst_5hr_peak),
      worstOpusPeak: Number(r.worst_opus_peak),
      totalDaysObserved: Number(r.total_days_observed),
      lastSeenAtMs: r.last_seen_ms == null ? null : Number(r.last_seen_ms),
    },
  }));
}

export async function loadLatestSnapshotsPerMember(
  teamId: string,
  pool: pg.Pool,
): Promise<MemberLatestSnapshot[]> {
  const res = await pool.query(`
    SELECT DISTINCT ON (pu.membership_id)
      pu.membership_id,
      COALESCE(u.display_name, u.email) AS member_name,
      m.plan_tier AS tier_key,
      pu.seven_day_utilization,
      pu.seven_day_resets_at,
      pu.captured_at
    FROM plan_utilization pu
    JOIN memberships m ON m.id = pu.membership_id
    JOIN user_accounts u ON u.id = m.user_account_id
    WHERE pu.team_id = $1
      AND pu.captured_at > now() - make_interval(hours => $2::int)
      AND m.revoked_at IS NULL
    ORDER BY pu.membership_id, pu.captured_at DESC
  `, [teamId, BURNDOWN_LATEST_WINDOW_HOURS]);

  return res.rows.map((r) => ({
    membershipId: r.membership_id,
    memberName: r.member_name ?? "(unnamed)",
    tierKey: r.tier_key as PlanTierKey,
    sevenDayUtilization:
      r.seven_day_utilization == null ? null : Number(r.seven_day_utilization),
    sevenDayResetsAt: r.seven_day_resets_at ? new Date(r.seven_day_resets_at) : null,
    capturedAt: new Date(r.captured_at),
  }));
}

export async function loadMembershipSparklines(
  teamId: string,
  pool: pg.Pool,
  weeks = 12,
): Promise<Map<string, number[]>> {
  const res = await pool.query<{
    membership_id: string;
    window_start_day: string;
    peak_seven_day_pct: number;
  }>(
    `SELECT membership_id, window_start_day::text, peak_seven_day_pct
     FROM membership_weekly_utilization
     WHERE team_id = $1
       AND window_start_day >= now() - make_interval(weeks => $2::int)
     ORDER BY membership_id, window_start_day ASC`,
    [teamId, weeks],
  );
  const out = new Map<string, number[]>();
  for (const r of res.rows) {
    const arr = out.get(r.membership_id) ?? [];
    arr.push(Number(r.peak_seven_day_pct ?? 0));
    out.set(r.membership_id, arr);
  }
  return out;
}

export async function loadMembersWithTier(
  teamId: string,
  pool: pg.Pool,
): Promise<Array<{
  id: string;
  email: string | null;
  display_name: string | null;
  plan_tier: string;
  revoked_at: string | null;
  joined_at: string;
}>> {
  const res = await pool.query(
    `SELECT m.id, u.email, u.display_name, m.plan_tier, m.revoked_at, m.joined_at
     FROM memberships m
     JOIN user_accounts u ON u.id = m.user_account_id
     WHERE m.team_id = $1
     ORDER BY m.joined_at`,
    [teamId],
  );
  return res.rows;
}

export type MemberPlanSummary = {
  planTier: string;
  avgSevenDayPct: number;
  worstSevenDayPeak: number;
  worstFiveHourPeak: number;
  totalDaysObserved: number;
  lastSeenAtMs: number | null;
  trail: number[];
};

export async function loadMemberPlanSummary(
  teamId: string,
  membershipId: string,
  pool: pg.Pool,
): Promise<MemberPlanSummary> {
  const [tierRes, statsRes, trailRes] = await Promise.all([
    pool.query<{ plan_tier: string }>(
      "SELECT plan_tier FROM memberships WHERE id = $1 AND team_id = $2",
      [membershipId, teamId],
    ),
    pool.query<{
      worst_7day_peak: number | null;
      avg_7day_avg: number | null;
      worst_5hr_peak: number | null;
      total_days_observed: number | null;
      last_seen_ms: number | null;
    }>(
      `SELECT
         MAX(peak_seven_day_pct)::float8     AS worst_7day_peak,
         AVG(avg_seven_day_pct)::float8      AS avg_7day_avg,
         MAX(peak_five_hour_pct)::float8     AS worst_5hr_peak,
         SUM(distinct_days_observed)::int    AS total_days_observed,
         EXTRACT(EPOCH FROM MAX(last_captured_at))::float8 * 1000 AS last_seen_ms
       FROM membership_weekly_utilization
       WHERE team_id = $1 AND membership_id = $2
         AND window_end >= now() - interval '30 days'`,
      [teamId, membershipId],
    ),
    pool.query<{ peak_seven_day_pct: number }>(
      `SELECT peak_seven_day_pct
       FROM membership_weekly_utilization
       WHERE team_id = $1 AND membership_id = $2
         AND window_start_day >= now() - interval '12 weeks'
       ORDER BY window_start_day ASC`,
      [teamId, membershipId],
    ),
  ]);

  const stats = statsRes.rows[0] ?? {
    worst_7day_peak: null,
    avg_7day_avg: null,
    worst_5hr_peak: null,
    total_days_observed: null,
    last_seen_ms: null,
  };

  return {
    planTier: tierRes.rows[0]?.plan_tier ?? "pro-max",
    avgSevenDayPct: Number(stats.avg_7day_avg ?? 0),
    worstSevenDayPeak: Number(stats.worst_7day_peak ?? 0),
    worstFiveHourPeak: Number(stats.worst_5hr_peak ?? 0),
    totalDaysObserved: Number(stats.total_days_observed ?? 0),
    lastSeenAtMs: stats.last_seen_ms == null ? null : Number(stats.last_seen_ms),
    trail: trailRes.rows.map((r) => Number(r.peak_seven_day_pct ?? 0)),
  };
}

export async function loadOptimizerSettings(
  teamId: string,
  pool: pg.Pool,
): Promise<OptimizerSettings> {
  const res = await pool.query<{ settings: { planOptimizer?: Partial<OptimizerSettings> } }>(
    "SELECT settings FROM teams WHERE id = $1",
    [teamId],
  );
  const overrides = res.rows[0]?.settings?.planOptimizer ?? {};
  return { ...DEFAULT_OPTIMIZER_SETTINGS, ...overrides };
}
