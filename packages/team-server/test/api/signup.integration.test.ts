import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { resetDb } from "../helpers/db.js";
import { NextRequest } from "next/server";
import { getPool } from "../../src/db/pool.js";
import { POST as signupPOST } from "../../src/app/api/auth/signup/route.js";
import { createUserAccount } from "../../src/lib/auth.js";
import { createTeamWithAdmin } from "../../src/lib/teams.js";

let pool: ReturnType<typeof getPool>;

function makeSignupReq(body: Record<string, unknown>, ip = "1.2.3.4"): NextRequest {
  return new NextRequest("http://localhost/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  pool = await resetDb();
});

afterAll(async () => {
  await pool.end();
});

describe("signup auto-promotion", () => {
  it("first signup on a fresh DB auto-promotes to is_staff=true", async () => {
    const req = makeSignupReq({
      email: "first@example.com",
      password: "securepassword1",
      teamName: "First Team",
    });
    const res = await signupPOST(req);
    expect(res.status).toBe(201);
    const row = await pool.query(
      "SELECT is_staff FROM user_accounts WHERE email = $1",
      ["first@example.com"],
    );
    expect(row.rows[0].is_staff).toBe(true);
  });

  it("second signup on a DB with a staff user does NOT auto-promote", async () => {
    // Pre-seed a staff user + a team so the second signup takes the invite path
    const staff = await createUserAccount(
      "staff-preseed@example.com",
      "pass1234",
      null,
      { isStaff: true },
      pool,
    );
    await createTeamWithAdmin("Preseed Team", staff.id, pool);
    // Enable public signup so subsequent self-signup is allowed
    await pool.query(
      "INSERT INTO server_config (key, value) VALUES ('allow_public_signup', 'true') ON CONFLICT (key) DO UPDATE SET value = 'true'",
    );

    const req = makeSignupReq({
      email: "second@example.com",
      password: "securepassword2",
    });
    const res = await signupPOST(req);
    expect(res.status).toBe(201);

    const row = await pool.query(
      "SELECT is_staff FROM user_accounts WHERE email = $1",
      ["second@example.com"],
    );
    expect(row.rows[0].is_staff).toBe(false);
  });

  it("two concurrent first-signups produce exactly one is_staff=true account", async () => {
    const reqA = makeSignupReq(
      { email: "race-a@example.com", password: "securepassword1", teamName: "Team A" },
      "1.1.1.1",
    );
    const reqB = makeSignupReq(
      { email: "race-b@example.com", password: "securepassword1", teamName: "Team B" },
      "2.2.2.2",
    );

    // Run concurrently
    await Promise.all([signupPOST(reqA), signupPOST(reqB)]);

    const count = await pool.query(
      "SELECT count(*)::int AS n FROM user_accounts WHERE is_staff = true",
    );
    expect(count.rows[0].n).toBe(1);
  });
});
