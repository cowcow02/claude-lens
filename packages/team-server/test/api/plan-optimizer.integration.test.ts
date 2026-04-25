import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { resetDb } from "../helpers/db.js";
import { NextRequest } from "next/server";
import { getPool } from "../../src/db/pool.js";
import { GET as optimizerGET } from "../../src/app/api/team/plan-optimizer/route.js";
import { GET as warningsGET } from "../../src/app/api/team/capacity-warnings/route.js";
import { createUserAccount, createSession } from "../../src/lib/auth.js";
import { createTeamWithAdmin } from "../../src/lib/teams.js";
import { createInvite, redeemInvite } from "../../src/lib/members.js";

let pool: ReturnType<typeof getPool>;
let teamId: string;
let teamSlug: string;
let adminCookieToken: string;
let memberCookieToken: string;
let adminMembershipId: string;
let memberMembershipId: string;

function makeAuthedReq(url: string, cookie: string): NextRequest {
  const headers = new Headers();
  headers.set("cookie", `fleetlens_session=${cookie}`);
  return new NextRequest(url, { headers });
}

beforeAll(async () => {
  pool = await resetDb();
  const admin = await createUserAccount("plan-admin@example.com", "pass1234", "Plan Admin", {}, pool);
  const { team, membership } = await createTeamWithAdmin("Plan Team", admin.id, pool);
  teamId = team.id;
  teamSlug = team.slug;
  adminMembershipId = membership.id;
  adminCookieToken = (await createSession(admin.id, pool)).cookieToken;

  const memberUser = await createUserAccount("plan-member@example.com", "pass1234", "Bob", {}, pool);
  const { token } = await createInvite(teamId, admin.id, {}, pool);
  memberMembershipId = (await redeemInvite(token, memberUser.id, pool))!.membershipId;
  memberCookieToken = (await createSession(memberUser.id, pool)).cookieToken;
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query("DELETE FROM plan_utilization WHERE team_id = $1", [teamId]);
  await pool.query("UPDATE memberships SET plan_tier = 'pro-max' WHERE team_id = $1", [teamId]);
  await pool.query("REFRESH MATERIALIZED VIEW membership_weekly_utilization");
});

async function seedSnapshots(
  membershipId: string,
  rows: Array<{ daysAgo: number; utilization: number; resetsInDays?: number }>,
) {
  for (const row of rows) {
    const capturedAt = new Date(Date.now() - row.daysAgo * 86_400_000);
    const resetsAt = new Date(
      capturedAt.getTime() + (row.resetsInDays ?? 7) * 86_400_000,
    );
    await pool.query(
      `INSERT INTO plan_utilization (
         team_id, membership_id, captured_at,
         five_hour_utilization, seven_day_utilization, seven_day_resets_at,
         seven_day_opus_utilization
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT DO NOTHING`,
      [teamId, membershipId, capturedAt, row.utilization * 0.6, row.utilization, resetsAt, row.utilization * 0.5],
    );
  }
  await pool.query("REFRESH MATERIALIZED VIEW membership_weekly_utilization");
}

describe("GET /api/team/plan-optimizer", () => {
  it("returns 400 when team slug is missing", async () => {
    const req = makeAuthedReq("http://localhost/api/team/plan-optimizer", adminCookieToken);
    const res = await optimizerGET(req);
    expect(res.status).toBe(400);
  });

  it("returns 401 without authentication", async () => {
    const req = new NextRequest(`http://localhost/api/team/plan-optimizer?team=${teamSlug}`);
    const res = await optimizerGET(req);
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-admin members", async () => {
    const req = makeAuthedReq(
      `http://localhost/api/team/plan-optimizer?team=${teamSlug}`,
      memberCookieToken,
    );
    const res = await optimizerGET(req);
    expect(res.status).toBe(403);
  });

  it("returns insufficient_data for fresh team with no snapshots", async () => {
    const req = makeAuthedReq(
      `http://localhost/api/team/plan-optimizer?team=${teamSlug}`,
      adminCookieToken,
    );
    const res = await optimizerGET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recommendations).toHaveLength(2);
    for (const rec of body.recommendations) {
      expect(rec.recommendation.action).toBe("insufficient_data");
    }
    expect(body.summary.membersInsufficientData).toBe(2);
  });

  it("recommends downgrade for low-usage member on top tier", async () => {
    await pool.query("UPDATE memberships SET plan_tier = 'pro-max-20x' WHERE id = $1", [memberMembershipId]);
    // 30 distinct days of low utilization
    const rows = Array.from({ length: 30 }, (_, i) => ({
      daysAgo: i,
      utilization: 25,
    }));
    await seedSnapshots(memberMembershipId, rows);

    const req = makeAuthedReq(
      `http://localhost/api/team/plan-optimizer?team=${teamSlug}`,
      adminCookieToken,
    );
    const res = await optimizerGET(req);
    const body = await res.json();
    const memberRec = body.recommendations.find((r: any) => r.membershipId === memberMembershipId);
    expect(memberRec.recommendation.action).toBe("downgrade");
    expect(memberRec.recommendation.targetTier).toBe("pro-max");
    expect(body.summary.membersToDowngrade).toBeGreaterThan(0);
    expect(body.summary.estimatedMonthlyDelta).toBeLessThan(0);
  });

  it("recommends upgrade_urgent for entry-tier member peaking high", async () => {
    await pool.query("UPDATE memberships SET plan_tier = 'pro' WHERE id = $1", [memberMembershipId]);
    const rows = Array.from({ length: 30 }, (_, i) => ({
      daysAgo: i,
      utilization: i === 0 ? 98 : 70,
    }));
    await seedSnapshots(memberMembershipId, rows);

    const req = makeAuthedReq(
      `http://localhost/api/team/plan-optimizer?team=${teamSlug}`,
      adminCookieToken,
    );
    const body = await (await optimizerGET(req)).json();
    const memberRec = body.recommendations.find((r: any) => r.membershipId === memberMembershipId);
    expect(memberRec.recommendation.action).toBe("upgrade_urgent");
    expect(memberRec.recommendation.targetTier).toBe("pro-max");
  });

  it("returns review_manually for custom tier even with full data", async () => {
    await pool.query("UPDATE memberships SET plan_tier = 'custom' WHERE id = $1", [memberMembershipId]);
    const rows = Array.from({ length: 30 }, (_, i) => ({
      daysAgo: i,
      utilization: 50,
    }));
    await seedSnapshots(memberMembershipId, rows);

    const req = makeAuthedReq(
      `http://localhost/api/team/plan-optimizer?team=${teamSlug}`,
      adminCookieToken,
    );
    const body = await (await optimizerGET(req)).json();
    const memberRec = body.recommendations.find((r: any) => r.membershipId === memberMembershipId);
    expect(memberRec.recommendation.action).toBe("review_manually");
    expect(body.summary.membersCustomTier).toBe(1);
  });

  it("settings field surfaces team override + defaults", async () => {
    await pool.query(
      `UPDATE teams SET settings = settings || '{"planOptimizer":{"upgradeIfAvgAbove":70}}' WHERE id = $1`,
      [teamId],
    );
    const req = makeAuthedReq(
      `http://localhost/api/team/plan-optimizer?team=${teamSlug}`,
      adminCookieToken,
    );
    const body = await (await optimizerGET(req)).json();
    expect(body.settings.upgradeIfAvgAbove).toBe(70);
    // Untouched defaults still flow through.
    expect(body.settings.minDaysRequired).toBe(14);
  });
});

describe("GET /api/team/capacity-warnings", () => {
  it("returns 401 without auth", async () => {
    const req = new NextRequest(`http://localhost/api/team/capacity-warnings?team=${teamSlug}`);
    const res = await warningsGET(req);
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-admin", async () => {
    const req = makeAuthedReq(
      `http://localhost/api/team/capacity-warnings?team=${teamSlug}`,
      memberCookieToken,
    );
    const res = await warningsGET(req);
    expect(res.status).toBe(403);
  });

  it("returns info-zero for team with no recent snapshots", async () => {
    const req = makeAuthedReq(
      `http://localhost/api/team/capacity-warnings?team=${teamSlug}`,
      adminCookieToken,
    );
    const res = await warningsGET(req);
    const body = await res.json();
    expect(body.burndown.level).toBe("info");
    expect(body.burndown.currentSpendUsd).toBe(0);
  });

  it("aggregates latest snapshots into burndown response", async () => {
    // 1 hour-old snapshot (within window): 50% utilization, 50% through window.
    const fractionElapsed = 0.5;
    const capturedAt = new Date(Date.now() - 30 * 60_000);
    const resetsAt = new Date(
      capturedAt.getTime() + (1 - fractionElapsed) * 7 * 86_400_000,
    );
    await pool.query(
      `INSERT INTO plan_utilization (
         team_id, membership_id, captured_at, seven_day_utilization, seven_day_resets_at
       ) VALUES ($1, $2, $3, 50, $4)`,
      [teamId, adminMembershipId, capturedAt, resetsAt],
    );

    const req = makeAuthedReq(
      `http://localhost/api/team/capacity-warnings?team=${teamSlug}`,
      adminCookieToken,
    );
    const body = await (await warningsGET(req)).json();
    // Only members with a snapshot in the last hour count — the burndown is a
    // projection of currently-reporting members, not a roster total. So one
    // pro-max member at 50% utilization → $50 spend out of $100 cap.
    expect(body.burndown.currentSpendUsd).toBeCloseTo(50, 0);
    expect(body.burndown.capUsd).toBe(100);
    expect(body.burndown.avgWindowFractionElapsed).toBeCloseTo(0.5, 1);
  });
});
