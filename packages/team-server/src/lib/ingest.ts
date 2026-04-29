import pg from "pg";
import { getPool } from "../db/pool";
import { IngestPayload, UsageHistoryPayload } from "./zod-schemas";
import { refreshMembershipWeeklyUtilization } from "./scheduler";
import { broadcastEvent } from "./sse";

export async function processIngest(
  raw: unknown,
  membershipId: string,
  teamId: string,
  pool?: pg.Pool
) {
  const p = pool || getPool();
  const payload = IngestPayload.parse(raw);
  const r = payload.dailyRollup;

  const client = await p.connect();
  try {
    await client.query("BEGIN");

    const logRes = await client.query(
      "INSERT INTO ingest_log (ingest_id, team_id, membership_id) VALUES ($1, $2, $3) ON CONFLICT (ingest_id) DO NOTHING RETURNING 1",
      [payload.ingestId, teamId, membershipId]
    );
    if (logRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return { accepted: true, deduplicated: true };
    }

    await client.query(`
      INSERT INTO daily_rollups (team_id, membership_id, day, agent_time_ms, sessions, tool_calls, turns,
                                 tokens_input, tokens_output, tokens_cache_read, tokens_cache_write)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (team_id, membership_id, day) DO UPDATE SET
        agent_time_ms = EXCLUDED.agent_time_ms,
        sessions = EXCLUDED.sessions,
        tool_calls = EXCLUDED.tool_calls,
        turns = EXCLUDED.turns,
        tokens_input = EXCLUDED.tokens_input,
        tokens_output = EXCLUDED.tokens_output,
        tokens_cache_read = EXCLUDED.tokens_cache_read,
        tokens_cache_write = EXCLUDED.tokens_cache_write
    `, [teamId, membershipId, r.day, r.agentTimeMs, r.sessions, r.toolCalls, r.turns,
        r.tokens.input, r.tokens.output, r.tokens.cacheRead, r.tokens.cacheWrite]);

    if (payload.planTier) {
      // Server-trusted source of truth — the daemon read this directly from
      // Anthropic's profile endpoint. Admin can still override post-hoc;
      // the next daemon push will reassert if Anthropic still reports the
      // same tier.
      await upsertMembershipPlanTier(client, teamId, membershipId, payload.planTier);
    }

    if (payload.usageSnapshot) {
      const u = payload.usageSnapshot;
      await client.query(`
        INSERT INTO plan_utilization (
          team_id, membership_id, captured_at,
          five_hour_utilization, five_hour_resets_at,
          seven_day_utilization, seven_day_resets_at,
          seven_day_opus_utilization, seven_day_sonnet_utilization,
          seven_day_oauth_apps_utilization, seven_day_cowork_utilization,
          extra_usage_enabled, extra_usage_monthly_limit_usd,
          extra_usage_used_credits_usd, extra_usage_utilization
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (team_id, membership_id, captured_at) DO NOTHING
      `, [
        teamId, membershipId, u.capturedAt,
        u.fiveHour.utilization, u.fiveHour.resetsAt,
        u.sevenDay.utilization, u.sevenDay.resetsAt,
        u.sevenDayOpus?.utilization ?? null,
        u.sevenDaySonnet?.utilization ?? null,
        u.sevenDayOauthApps?.utilization ?? null,
        u.sevenDayCowork?.utilization ?? null,
        u.extraUsage?.isEnabled ?? false,
        u.extraUsage?.monthlyLimitUsd ?? null,
        u.extraUsage?.usedCreditsUsd ?? null,
        u.extraUsage?.utilization ?? null,
      ]);
    }

    await client.query("UPDATE memberships SET last_seen_at = now() WHERE id = $1", [membershipId]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  broadcastEvent(teamId, "roster-updated", { membershipId });
  return { accepted: true, nextSyncAfter: new Date(Date.now() + 5 * 60 * 1000).toISOString() };
}

// Bulk-loads historical UsageSnapshot rows from the daemon's local
// usage.jsonl. Called once on first `team join` so the dashboard reflects
// pre-pairing data instead of waiting 7+ days to leave "insufficient_data".
// Idempotent via the (team_id, membership_id, captured_at) unique key, so
// it's safe to re-run.
export async function processUsageHistory(
  raw: unknown,
  membershipId: string,
  teamId: string,
  pool?: pg.Pool,
) {
  const p = pool || getPool();
  const { snapshots, planTier } = UsageHistoryPayload.parse(raw);

  let inserted = 0;
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    if (planTier) {
      await upsertMembershipPlanTier(client, teamId, membershipId, planTier);
    }
    for (const u of snapshots) {
      const res = await client.query(
        `INSERT INTO plan_utilization (
           team_id, membership_id, captured_at,
           five_hour_utilization, five_hour_resets_at,
           seven_day_utilization, seven_day_resets_at,
           seven_day_opus_utilization, seven_day_sonnet_utilization,
           seven_day_oauth_apps_utilization, seven_day_cowork_utilization,
           extra_usage_enabled, extra_usage_monthly_limit_usd,
           extra_usage_used_credits_usd, extra_usage_utilization
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (team_id, membership_id, captured_at) DO NOTHING`,
        [
          teamId, membershipId, u.capturedAt,
          u.fiveHour.utilization, u.fiveHour.resetsAt,
          u.sevenDay.utilization, u.sevenDay.resetsAt,
          u.sevenDayOpus?.utilization ?? null,
          u.sevenDaySonnet?.utilization ?? null,
          u.sevenDayOauthApps?.utilization ?? null,
          u.sevenDayCowork?.utilization ?? null,
          u.extraUsage?.isEnabled ?? false,
          u.extraUsage?.monthlyLimitUsd ?? null,
          u.extraUsage?.usedCreditsUsd ?? null,
          u.extraUsage?.utilization ?? null,
        ],
      );
      if (res.rowCount === 1) inserted++;
    }
    await client.query("UPDATE memberships SET last_seen_at = now() WHERE id = $1", [membershipId]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  // Surface backfilled data on the dashboard immediately rather than waiting
  // for the hourly scheduler tick.
  if (inserted > 0) {
    try {
      await refreshMembershipWeeklyUtilization();
    } catch {
      // Refresh races with the scheduler are non-fatal — the next hourly
      // tick will correct any missed concurrent refresh.
    }
    broadcastEvent(teamId, "roster-updated", { membershipId });
  }

  return { accepted: true, received: snapshots.length, inserted, skipped: snapshots.length - inserted };
}

// Audit-logged upsert. Skips the write when the value already matches so
// the audit log doesn't fill with no-op ticks every 5 minutes.
async function upsertMembershipPlanTier(
  client: pg.PoolClient,
  teamId: string,
  membershipId: string,
  planTier: string,
): Promise<void> {
  const cur = await client.query<{ plan_tier: string }>(
    "SELECT plan_tier FROM memberships WHERE id = $1 AND team_id = $2",
    [membershipId, teamId],
  );
  const previous = cur.rows[0]?.plan_tier ?? null;
  if (previous === planTier) return;

  await client.query(
    "UPDATE memberships SET plan_tier = $1 WHERE id = $2 AND team_id = $3",
    [planTier, membershipId, teamId],
  );
  await client.query(
    "INSERT INTO events (team_id, actor_id, action, payload) VALUES ($1, NULL, 'members.plan_tier_auto_detected', $2)",
    [teamId, JSON.stringify({ membershipId, previousTier: previous, newTier: planTier, source: "anthropic_profile" })],
  );
}
