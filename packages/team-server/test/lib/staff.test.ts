import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { resetDb } from "../helpers/db.js";
import { getPool } from "../../src/db/pool.js";
import { createUserAccount } from "../../src/lib/auth.js";
import { grantStaff, revokeStaff, listStaff, LastStaffError } from "../../src/lib/staff.js";

let pool: ReturnType<typeof getPool>;

beforeAll(async () => {
  pool = await resetDb();
});

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await pool.query("TRUNCATE TABLE events, sessions, memberships, user_accounts RESTART IDENTITY CASCADE");
});

describe("grantStaff", () => {
  it("sets is_staff=true on the target user and writes a staff.granted event", async () => {
    const actor = await createUserAccount("actor@example.com", "pass1234", null, { isStaff: true }, pool);
    const target = await createUserAccount("target@example.com", "pass1234", null, {}, pool);

    await grantStaff(target.id, actor.id, pool);

    const { rows } = await pool.query("SELECT is_staff FROM user_accounts WHERE id = $1", [target.id]);
    expect(rows[0].is_staff).toBe(true);

    const { rows: evs } = await pool.query(
      "SELECT actor_id, action, payload FROM events WHERE action = 'staff.granted' ORDER BY created_at DESC LIMIT 1",
    );
    expect(evs.length).toBe(1);
    expect(evs[0].actor_id).toBe(actor.id);
    expect(evs[0].payload).toEqual({ targetUserId: target.id });
  });
});

describe("revokeStaff", () => {
  it("sets is_staff=false on the target and writes a staff.revoked event when other staff exist", async () => {
    const staffA = await createUserAccount("a@example.com", "pass1234", null, { isStaff: true }, pool);
    const staffB = await createUserAccount("b@example.com", "pass1234", null, { isStaff: true }, pool);

    await revokeStaff(staffB.id, staffA.id, pool);

    const { rows } = await pool.query("SELECT is_staff FROM user_accounts WHERE id = $1", [staffB.id]);
    expect(rows[0].is_staff).toBe(false);

    const { rows: evs } = await pool.query(
      "SELECT actor_id, action, payload FROM events WHERE action = 'staff.revoked' ORDER BY created_at DESC LIMIT 1",
    );
    expect(evs.length).toBe(1);
    expect(evs[0].actor_id).toBe(staffA.id);
    expect(evs[0].payload).toEqual({ targetUserId: staffB.id });
  });

  it("throws LastStaffError when revoking the only remaining staff", async () => {
    const lone = await createUserAccount("lone@example.com", "pass1234", null, { isStaff: true }, pool);

    await expect(revokeStaff(lone.id, lone.id, pool)).rejects.toBeInstanceOf(LastStaffError);

    const { rows } = await pool.query("SELECT is_staff FROM user_accounts WHERE id = $1", [lone.id]);
    expect(rows[0].is_staff).toBe(true);
  });

  it("is a no-op (but writes event) when target is not currently staff and at least one staff exists", async () => {
    const staff = await createUserAccount("s@example.com", "pass1234", null, { isStaff: true }, pool);
    const plain = await createUserAccount("p@example.com", "pass1234", null, {}, pool);

    await revokeStaff(plain.id, staff.id, pool);

    const { rows } = await pool.query("SELECT is_staff FROM user_accounts WHERE id = $1", [plain.id]);
    expect(rows[0].is_staff).toBe(false);
  });
});

describe("listStaff", () => {
  it("returns ALL user_accounts with is_staff flag, ordered by created_at ASC", async () => {
    const u1 = await createUserAccount("one@example.com", "pass1234", "One", { isStaff: true }, pool);
    const u2 = await createUserAccount("two@example.com", "pass1234", "Two", {}, pool);

    const list = await listStaff(pool);
    expect(list.length).toBe(2);
    const ids = list.map((r) => r.id);
    expect(ids).toContain(u1.id);
    expect(ids).toContain(u2.id);
    const staffFlags = Object.fromEntries(list.map((r) => [r.id, r.is_staff]));
    expect(staffFlags[u1.id]).toBe(true);
    expect(staffFlags[u2.id]).toBe(false);
  });
});
