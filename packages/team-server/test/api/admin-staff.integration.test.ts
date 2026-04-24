import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { resetDb } from "../helpers/db.js";
import { NextRequest } from "next/server";
import { getPool } from "../../src/db/pool.js";

const { GET: listGET } = await import("../../src/app/api/admin/staff/route.js");
const { POST: grantPOST } = await import("../../src/app/api/admin/staff/grant/route.js");
const { POST: revokePOST } = await import("../../src/app/api/admin/staff/revoke/route.js");

const { createUserAccount, createSession } = await import("../../src/lib/auth.js");

let pool: ReturnType<typeof getPool>;

function makeReq(url: string, opts: { method?: string; headers?: HeadersInit; body?: BodyInit | null } = {}): NextRequest {
  return new NextRequest(url, opts);
}

function makeAuthedReq(
  url: string,
  cookie: string,
  opts: { method?: string; headers?: HeadersInit; body?: BodyInit | null } = {},
): NextRequest {
  const headers = new Headers(opts.headers as HeadersInit | undefined);
  headers.set("cookie", `fleetlens_session=${cookie}`);
  return new NextRequest(url, { ...opts, headers });
}

async function makeStaff(email: string) {
  const u = await createUserAccount(email, "pass1234", "Staff", {}, pool);
  await pool.query("UPDATE user_accounts SET is_staff = true WHERE id = $1", [u.id]);
  const { cookieToken } = await createSession(u.id, pool);
  return { id: u.id, cookie: cookieToken };
}

async function makeNonStaff(email: string) {
  const u = await createUserAccount(email, "pass1234", "Member", {}, pool);
  const { cookieToken } = await createSession(u.id, pool);
  return { id: u.id, cookie: cookieToken };
}

beforeAll(async () => {
  pool = await resetDb();
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query("TRUNCATE TABLE events, sessions, memberships, user_accounts RESTART IDENTITY CASCADE");
});

describe("GET /api/admin/staff", () => {
  it("returns 401 without a session cookie", async () => {
    const req = makeReq("http://localhost/api/admin/staff");
    const res = await listGET(req);
    expect(res.status).toBe(401);
  });

  it("returns 403 for a non-staff user", async () => {
    await makeStaff("boss@example.com"); // keeps is_staff > 0 for realism
    const ns = await makeNonStaff("member@example.com");
    const req = makeAuthedReq("http://localhost/api/admin/staff", ns.cookie);
    const res = await listGET(req);
    expect(res.status).toBe(403);
  });

  it("returns the list of all users (with is_staff flag) for a staff session", async () => {
    const staff = await makeStaff("boss2@example.com");
    await makeNonStaff("plain@example.com");
    const req = makeAuthedReq("http://localhost/api/admin/staff", staff.cookie);
    const res = await listGET(req);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { users: Array<{ id: string; email: string; is_staff: boolean }> };
    expect(data.users.length).toBe(2);
    const flags = Object.fromEntries(data.users.map((u) => [u.email, u.is_staff]));
    expect(flags["boss2@example.com"]).toBe(true);
    expect(flags["plain@example.com"]).toBe(false);
  });
});

describe("POST /api/admin/staff/grant", () => {
  it("returns 401 without a session cookie", async () => {
    const req = makeReq("http://localhost/api/admin/staff/grant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUserId: "x" }),
    });
    const res = await grantPOST(req);
    expect(res.status).toBe(401);
  });

  it("returns 403 for a non-staff user", async () => {
    await makeStaff("keep@example.com");
    const ns = await makeNonStaff("member2@example.com");
    const req = makeAuthedReq("http://localhost/api/admin/staff/grant", ns.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUserId: ns.id }),
    });
    const res = await grantPOST(req);
    expect(res.status).toBe(403);
  });

  it("returns 400 when targetUserId is missing", async () => {
    const staff = await makeStaff("boss3@example.com");
    const req = makeAuthedReq("http://localhost/api/admin/staff/grant", staff.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await grantPOST(req);
    expect(res.status).toBe(400);
  });

  it("promotes the target to staff and writes a staff.granted event", async () => {
    const staff = await makeStaff("boss4@example.com");
    const target = await makeNonStaff("newstaff@example.com");
    const req = makeAuthedReq("http://localhost/api/admin/staff/grant", staff.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUserId: target.id }),
    });
    const res = await grantPOST(req);
    expect(res.status).toBe(200);

    const { rows } = await pool.query("SELECT is_staff FROM user_accounts WHERE id = $1", [target.id]);
    expect(rows[0].is_staff).toBe(true);

    const { rows: evs } = await pool.query(
      "SELECT actor_id, payload FROM events WHERE action = 'staff.granted' ORDER BY created_at DESC LIMIT 1",
    );
    expect(evs[0].actor_id).toBe(staff.id);
    expect(evs[0].payload).toEqual({ targetUserId: target.id });
  });
});

describe("POST /api/admin/staff/revoke", () => {
  it("returns 401 without a session cookie", async () => {
    const req = makeReq("http://localhost/api/admin/staff/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUserId: "x" }),
    });
    const res = await revokePOST(req);
    expect(res.status).toBe(401);
  });

  it("returns 403 for a non-staff user", async () => {
    await makeStaff("keepboss@example.com");
    const ns = await makeNonStaff("notstaff@example.com");
    const req = makeAuthedReq("http://localhost/api/admin/staff/revoke", ns.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUserId: ns.id }),
    });
    const res = await revokePOST(req);
    expect(res.status).toBe(403);
  });

  it("demotes a non-last staff target and writes a staff.revoked event", async () => {
    const staffA = await makeStaff("aaa@example.com");
    const staffB = await makeStaff("bbb@example.com");
    const req = makeAuthedReq("http://localhost/api/admin/staff/revoke", staffA.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUserId: staffB.id }),
    });
    const res = await revokePOST(req);
    expect(res.status).toBe(200);

    const { rows } = await pool.query("SELECT is_staff FROM user_accounts WHERE id = $1", [staffB.id]);
    expect(rows[0].is_staff).toBe(false);

    const { rows: evs } = await pool.query(
      "SELECT actor_id, payload FROM events WHERE action = 'staff.revoked' ORDER BY created_at DESC LIMIT 1",
    );
    expect(evs[0].actor_id).toBe(staffA.id);
    expect(evs[0].payload).toEqual({ targetUserId: staffB.id });
  });

  it("returns 400 when revoking the last remaining staff", async () => {
    const lone = await makeStaff("only@example.com");
    const req = makeAuthedReq("http://localhost/api/admin/staff/revoke", lone.cookie, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetUserId: lone.id }),
    });
    const res = await revokePOST(req);
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toMatch(/last remaining/i);

    const { rows } = await pool.query("SELECT is_staff FROM user_accounts WHERE id = $1", [lone.id]);
    expect(rows[0].is_staff).toBe(true);
  });
});

describe("rate limiting", () => {
  it("returns 429 after 10 grant/revoke actions from the same actor within an hour", async () => {
    const actor = await makeStaff("burst@example.com");
    // Spawn 11 non-staff targets; first 10 grants allowed, 11th blocked.
    const targets: Array<{ id: string }> = [];
    for (let i = 0; i < 11; i++) {
      targets.push(await makeNonStaff(`t${i}@example.com`));
    }

    let lastStatus = 0;
    for (let i = 0; i < 11; i++) {
      const req = makeAuthedReq("http://localhost/api/admin/staff/grant", actor.cookie, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId: targets[i].id }),
      });
      const res = await grantPOST(req);
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});
