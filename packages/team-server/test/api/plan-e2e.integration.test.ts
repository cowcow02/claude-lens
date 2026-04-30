// End-to-end smoke for Doc 2 Chunk 2 — seeds three members with realistic
// 30-day utilization shapes and verifies the optimizer + burndown endpoints
// land the right verdicts on each.

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
let adminCookie: string;
const memberships = {
  alice: "",
  bob: "",
  carol: "",
};

function makeAuthedReq(url: string, cookie: string): NextRequest {
  const headers = new Headers();
  headers.set("cookie", `fleetlens_session=${cookie}`);
  return new NextRequest(url, { headers });
}

beforeAll(async () => {
  pool = await resetDb();
  const admin = await createUserAccount("e2e-admin@example.com", "pass1234", "E2E Admin", {}, pool);
  const { team, membership } = await createTeamWithAdmin("E2E Plan Team", admin.id, pool);
  teamId = team.id;
  teamSlug = team.slug;
  memberships.alice = membership.id;
  adminCookie = (await createSession(admin.id, pool)).cookieToken;

  const bob = await createUserAccount("bob@example.com", "pass1234", "Bob", {}, pool);
  const tokenB = (await createInvite(teamId, admin.id, {}, pool)).token;
  memberships.bob = (await redeemInvite(tokenB, bob.id, pool))!.membershipId;

  const carol = await createUserAccount("carol@example.com", "pass1234", "Carol", {}, pool);
  const tokenC = (await createInvite(teamId, admin.id, {}, pool)).token;
  memberships.carol = (await redeemInvite(tokenC, carol.id, pool))!.membershipId;
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query("DELETE FROM plan_utilization WHERE team_id = $1", [teamId]);
  await pool.query("REFRESH MATERIALIZED VIEW membership_weekly_utilization");
});

async function seedDaily(
  membershipId: string,
  rows: Array<{ daysAgo: number; sevenDayPct: number; fiveHourPct?: number }>,
) {
  for (const row of rows) {
    const captured = new Date(Date.now() - row.daysAgo * 86_400_000);
    const resets = new Date(captured.getTime() + 7 * 86_400_000);
    await pool.query(
      `INSERT INTO plan_utilization (
         team_id, membership_id, captured_at,
         five_hour_utilization, seven_day_utilization, seven_day_resets_at
       ) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING`,
      [teamId, membershipId, captured, row.fiveHourPct ?? row.sevenDayPct * 0.6, row.sevenDayPct, resets],
    );
  }
}

describe("Doc 2 e2e: 3-member team", () => {
  it("optimizer returns one upgrade_urgent, one downgrade, one stay", async () => {
    // Alice (admin): on pro, peaked 98%, 30 days observed → upgrade_urgent.
    await pool.query("UPDATE memberships SET plan_tier = 'pro' WHERE id = $1", [memberships.alice]);
    const aliceRows = Array.from({ length: 30 }, (_, i) => ({
      daysAgo: i,
      sevenDayPct: i === 0 ? 98 : 65,
    }));
    await seedDaily(memberships.alice, aliceRows);

    // Bob: on pro-max-20x, avg 30%, peak 50%, 30 days → downgrade.
    await pool.query("UPDATE memberships SET plan_tier = 'pro-max-20x' WHERE id = $1", [memberships.bob]);
    const bobRows = Array.from({ length: 30 }, (_, i) => ({
      daysAgo: i,
      sevenDayPct: i % 5 === 0 ? 50 : 30,
    }));
    await seedDaily(memberships.bob, bobRows);

    // Carol: on pro-max, avg 60%, peak 75%, 30 days → stay.
    await pool.query("UPDATE memberships SET plan_tier = 'pro-max' WHERE id = $1", [memberships.carol]);
    const carolRows = Array.from({ length: 30 }, (_, i) => ({
      daysAgo: i,
      sevenDayPct: i % 7 === 0 ? 75 : 55,
    }));
    await seedDaily(memberships.carol, carolRows);

    await pool.query("REFRESH MATERIALIZED VIEW membership_weekly_utilization");

    const req = makeAuthedReq(
      `http://localhost/api/team/plan-optimizer?team=${teamSlug}`,
      adminCookie,
    );
    const body = await (await optimizerGET(req)).json();

    const recs = new Map<string, any>(
      body.recommendations.map((r: any) => [r.membershipId, r.recommendation]),
    );
    expect(recs.get(memberships.alice).action).toBe("upgrade_urgent");
    expect(recs.get(memberships.bob).action).toBe("downgrade");
    expect(recs.get(memberships.carol).action).toBe("stay");

    // Bob's downgrade should produce a positive savings number.
    expect(recs.get(memberships.bob).estimatedSavingsUsd).toBeGreaterThan(0);

    // Summary should reflect what we just asserted member-by-member.
    expect(body.summary.membersToUpgrade).toBeGreaterThanOrEqual(1);
    expect(body.summary.membersToDowngrade).toBeGreaterThanOrEqual(1);
    expect(body.summary.estimatedMonthlyDelta).toBeLessThan(0);
  });

  it("burndown reflects current utilization across the live members", async () => {
    // Reset everyone to pro-max so the math is clean.
    await pool.query(
      "UPDATE memberships SET plan_tier = 'pro-max' WHERE team_id = $1",
      [teamId],
    );
    // Three members, all 60% through window, varying utilizations.
    const fractionElapsed = 0.6;
    const captured = new Date(Date.now() - 30 * 60_000);
    const resets = new Date(
      captured.getTime() + (1 - fractionElapsed) * 7 * 86_400_000,
    );
    for (const [memberName, util] of [
      [memberships.alice, 70],
      [memberships.bob, 65],
      [memberships.carol, 60],
    ] as const) {
      await pool.query(
        `INSERT INTO plan_utilization (
           team_id, membership_id, captured_at, seven_day_utilization, seven_day_resets_at
         ) VALUES ($1, $2, $3, $4, $5)`,
        [teamId, memberName, captured, util, resets],
      );
    }

    const req = makeAuthedReq(
      `http://localhost/api/team/capacity-warnings?team=${teamSlug}`,
      adminCookie,
    );
    const body = await (await warningsGET(req)).json();
    expect(body.burndown.capUsd).toBe(300); // 3 × pro-max ($100/mo)
    // Total spend = (70 + 65 + 60)% × 100 = $195. Projection ≈ 195 / 0.6 = $325,
    // give-or-take a few dollars from the captured_at offset baked into the
    // setup. Tolerance is 10.
    expect(body.burndown.currentSpendUsd).toBeCloseTo(195, 0);
    expect(body.burndown.projectedEndOfWindowUsd).toBeCloseTo(325, -1);
    expect(body.burndown.level).toBe("red");
    expect(body.burndown.topContributors[0].memberName).toBe("E2E Admin");
  });
});
