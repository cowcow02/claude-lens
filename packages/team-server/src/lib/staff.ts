import type pg from "pg";

export class LastStaffError extends Error {
  constructor() {
    super("Cannot revoke staff from the last remaining staff user");
    this.name = "LastStaffError";
  }
}

export type StaffRow = {
  id: string;
  email: string;
  display_name: string | null;
  is_staff: boolean;
  created_at: Date;
};

export async function grantStaff(targetUserId: string, actorId: string, pool: pg.Pool): Promise<void> {
  await pool.query("UPDATE user_accounts SET is_staff = true WHERE id = $1", [targetUserId]);
  await pool.query(
    `INSERT INTO events (actor_id, action, payload) VALUES ($1, 'staff.granted', $2)`,
    [actorId, JSON.stringify({ targetUserId })],
  );
}

/**
 * Transactional revoke. Two concurrent revocations of the last remaining staff
 * must not both succeed; the count-and-update happens on the SAME client inside
 * BEGIN/COMMIT so each transaction sees a consistent snapshot.
 */
export async function revokeStaff(
  targetUserId: string,
  actorId: string,
  pool: pg.Pool,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "SELECT count(*)::int AS n FROM user_accounts WHERE is_staff = true",
    );
    if (rows[0].n <= 1) {
      const { rows: targetRows } = await client.query(
        "SELECT is_staff FROM user_accounts WHERE id = $1",
        [targetUserId],
      );
      if (targetRows[0]?.is_staff) throw new LastStaffError();
    }
    await client.query("UPDATE user_accounts SET is_staff = false WHERE id = $1", [targetUserId]);
    await client.query(
      `INSERT INTO events (actor_id, action, payload) VALUES ($1, 'staff.revoked', $2)`,
      [actorId, JSON.stringify({ targetUserId })],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function listStaff(pool: pg.Pool): Promise<StaffRow[]> {
  const { rows } = await pool.query<StaffRow>(
    "SELECT id, email, display_name, is_staff, created_at FROM user_accounts ORDER BY created_at ASC",
  );
  return rows;
}
