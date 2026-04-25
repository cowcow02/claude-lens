import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { resetDb } from "../helpers/db.js";
import { getPool } from "../../src/db/pool.js";
import { processIngest } from "../../src/lib/ingest.js";
import { addClient } from "../../src/lib/sse.js";
import { createUserAccount } from "../../src/lib/auth.js";
import { createTeamWithAdmin } from "../../src/lib/teams.js";
let pool: ReturnType<typeof getPool>;
let membershipId: string;
let teamId: string;

function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    ingestId: `ingest-${Math.random().toString(36).slice(2)}`,
    observedAt: new Date().toISOString(),
    dailyRollup: {
      day: new Date().toISOString().slice(0, 10),
      agentTimeMs: 3600000,
      sessions: 3,
      toolCalls: 20,
      turns: 8,
      tokens: { input: 500, output: 300, cacheRead: 100, cacheWrite: 50 },
    },
    ...overrides,
  };
}

beforeAll(async () => {
  pool = await resetDb();
  const admin = await createUserAccount("ingest-admin@example.com", "pass1234", null, {}, pool);
  const { team, membership } = await createTeamWithAdmin("Ingest Team", admin.id, pool);
  teamId = team.id;
  membershipId = membership.id;
});

afterAll(async () => {
  await pool.end();
});

describe("processIngest", () => {
  it("returns accepted=true and nextSyncAfter on success", async () => {
    const result = await processIngest(makePayload(), membershipId, teamId, pool);
    expect(result.accepted).toBe(true);
    expect(result.nextSyncAfter).toBeTruthy();
  });

  it("deduplicates: second call with same ingestId returns deduplicated=true", async () => {
    const payload = makePayload();
    await processIngest(payload, membershipId, teamId, pool);
    const result = await processIngest(payload, membershipId, teamId, pool);
    expect(result.accepted).toBe(true);
    expect(result.deduplicated).toBe(true);
  });

  it("upserts daily_rollups (ON CONFLICT updates row)", async () => {
    const day = "2024-06-15";
    const first = makePayload({
      dailyRollup: {
        day,
        agentTimeMs: 1000,
        sessions: 1,
        toolCalls: 5,
        turns: 2,
        tokens: { input: 100, output: 50, cacheRead: 10, cacheWrite: 5 },
      },
    });
    await processIngest(first, membershipId, teamId, pool);

    // Different ingestId, same day → should overwrite
    const second = makePayload({
      dailyRollup: {
        day,
        agentTimeMs: 9000,
        sessions: 10,
        toolCalls: 50,
        turns: 20,
        tokens: { input: 900, output: 500, cacheRead: 90, cacheWrite: 45 },
      },
    });
    await processIngest(second, membershipId, teamId, pool);

    const row = await pool.query(
      "SELECT sessions, agent_time_ms FROM daily_rollups WHERE team_id=$1 AND membership_id=$2 AND day=$3",
      [teamId, membershipId, day]
    );
    expect(row.rows[0].sessions).toBe(10);
    expect(Number(row.rows[0].agent_time_ms)).toBe(9000);
  });

  it("bumps last_seen_at on the membership", async () => {
    await pool.query(
      "UPDATE memberships SET last_seen_at = null WHERE id = $1",
      [membershipId]
    );
    await processIngest(makePayload(), membershipId, teamId, pool);
    const row = await pool.query(
      "SELECT last_seen_at FROM memberships WHERE id = $1",
      [membershipId]
    );
    expect(row.rows[0].last_seen_at).not.toBeNull();
  });

  it("broadcasts an SSE roster-updated event on success", async () => {
    const received: string[] = [];
    const ctrl = {
      enqueue(chunk: Uint8Array) {
        received.push(new TextDecoder().decode(chunk));
      },
    } as unknown as ReadableStreamDefaultController;
    const cleanup = addClient(ctrl, teamId);

    await processIngest(makePayload(), membershipId, teamId, pool);

    expect(received.some((m) => m.includes("roster-updated"))).toBe(true);
    cleanup();
  });

  it("throws ZodError for invalid payload (bad day format)", async () => {
    const bad = {
      ingestId: "bad-ingest",
      observedAt: new Date().toISOString(),
      dailyRollup: {
        day: "not-a-date",
        agentTimeMs: 0,
        sessions: 0,
        toolCalls: 0,
        turns: 0,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    };
    await expect(processIngest(bad, membershipId, teamId, pool)).rejects.toThrow();
  });

  it("throws ZodError when dailyRollup is missing", async () => {
    await expect(
      processIngest({ ingestId: "x", observedAt: new Date().toISOString() }, membershipId, teamId, pool)
    ).rejects.toThrow();
  });

  it("inserts plan_utilization row when usageSnapshot present", async () => {
    const capturedAt = new Date("2026-04-22T10:30:00Z").toISOString();
    const payload = makePayload({
      usageSnapshot: {
        capturedAt,
        fiveHour: { utilization: 23.7, resetsAt: "2026-04-22T14:00:00Z" },
        sevenDay: { utilization: 47.2, resetsAt: "2026-04-26T00:00:00Z" },
        sevenDayOpus: { utilization: 61.0, resetsAt: "2026-04-26T00:00:00Z" },
        sevenDaySonnet: { utilization: 31.4, resetsAt: "2026-04-26T00:00:00Z" },
        sevenDayOauthApps: null,
        sevenDayCowork: null,
        extraUsage: null,
      },
    });
    await processIngest(payload, membershipId, teamId, pool);

    const { rows } = await pool.query(
      `SELECT seven_day_utilization, seven_day_opus_utilization, extra_usage_enabled
       FROM plan_utilization WHERE team_id=$1 AND membership_id=$2 AND captured_at=$3`,
      [teamId, membershipId, capturedAt]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].seven_day_utilization).toBeCloseTo(47.2, 4);
    expect(rows[0].seven_day_opus_utilization).toBeCloseTo(61.0, 4);
    expect(rows[0].extra_usage_enabled).toBe(false);
  });

  it("skips plan_utilization insert when usageSnapshot absent", async () => {
    const before = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM plan_utilization WHERE membership_id = $1",
      [membershipId]
    );
    await processIngest(makePayload(), membershipId, teamId, pool);
    const after = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM plan_utilization WHERE membership_id = $1",
      [membershipId]
    );
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  it("plan_utilization is idempotent on (team, membership, captured_at)", async () => {
    const capturedAt = new Date("2026-04-23T08:00:00Z").toISOString();
    const snapshot = {
      capturedAt,
      fiveHour: { utilization: 10, resetsAt: "2026-04-23T13:00:00Z" },
      sevenDay: { utilization: 20, resetsAt: "2026-04-27T00:00:00Z" },
      sevenDayOpus: null,
      sevenDaySonnet: null,
      sevenDayOauthApps: null,
      sevenDayCowork: null,
      extraUsage: null,
    };
    // Two distinct ingestIds, same captured_at: only one plan_utilization row.
    await processIngest(makePayload({ usageSnapshot: snapshot }), membershipId, teamId, pool);
    await processIngest(makePayload({ usageSnapshot: snapshot }), membershipId, teamId, pool);

    const { rows } = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM plan_utilization WHERE membership_id=$1 AND captured_at=$2",
      [membershipId, capturedAt]
    );
    expect(rows[0].count).toBe("1");
  });

  it("captures extra_usage credits when present", async () => {
    const capturedAt = new Date("2026-04-24T12:00:00Z").toISOString();
    await processIngest(
      makePayload({
        usageSnapshot: {
          capturedAt,
          fiveHour: { utilization: 15, resetsAt: "2026-04-24T17:00:00Z" },
          sevenDay: { utilization: 88, resetsAt: "2026-04-28T00:00:00Z" },
          sevenDayOpus: null,
          sevenDaySonnet: null,
          sevenDayOauthApps: null,
          sevenDayCowork: null,
          extraUsage: {
            isEnabled: true,
            monthlyLimitUsd: 50,
            usedCreditsUsd: 12.5,
            utilization: 25,
          },
        },
      }),
      membershipId,
      teamId,
      pool,
    );

    const { rows } = await pool.query(
      `SELECT extra_usage_enabled, extra_usage_monthly_limit_usd, extra_usage_used_credits_usd
       FROM plan_utilization WHERE captured_at = $1`,
      [capturedAt],
    );
    expect(rows[0].extra_usage_enabled).toBe(true);
    expect(rows[0].extra_usage_monthly_limit_usd).toBeCloseTo(50, 4);
    expect(rows[0].extra_usage_used_credits_usd).toBeCloseTo(12.5, 4);
  });
});
