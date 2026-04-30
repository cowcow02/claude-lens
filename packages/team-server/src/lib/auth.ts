import type pg from "pg";
import { generateToken, sha256 } from "./crypto";
import { hashPassword, verifyPassword } from "./password";

const SESSION_TTL_MS = 10 * 365 * 24 * 60 * 60 * 1000;

export type UserAccount = {
  id: string;
  email: string;
  display_name: string | null;
  is_staff: boolean;
};

export type Membership = {
  id: string;
  team_id: string;
  role: "admin" | "member";
};

export type SessionContext = {
  user: UserAccount;
  sessionId: string;
  memberships: Membership[];
};

/**
 * Create a user account directly. For production signup, use
 * createFirstOrSubsequentUser() — it wraps the staff check-and-insert in an
 * advisory lock to prevent concurrent-signup races. The `opts.isStaff` flag
 * here is for test-seeding established staff users, not bootstrap flows.
 */
export async function createUserAccount(
  email: string,
  password: string,
  displayName: string | null,
  opts: { isStaff?: boolean } = {},
  pool: pg.Pool,
): Promise<UserAccount> {
  const hash = hashPassword(password);
  const res = await pool.query(
    `INSERT INTO user_accounts (email, password_hash, display_name, is_staff)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, display_name, is_staff`,
    [email.toLowerCase().trim(), hash, displayName, !!opts.isStaff]
  );
  return res.rows[0];
}

// Advisory lock key for first-signup serialization. Arbitrary 64-bit constant;
// must match wherever else we want to coordinate with the first-staff check.
const STAFF_BOOTSTRAP_LOCK = 0x6c5f7365_74737466n; // "l_setstf" ASCII

/**
 * Create a user account, auto-promoting to is_staff=true iff no staff exists yet.
 * The staff-count check + insert run inside a single transaction with an advisory lock,
 * so concurrent "first signups" produce exactly one is_staff=true account.
 */
export async function createFirstOrSubsequentUser(
  email: string,
  password: string,
  displayName: string | null,
  pool: pg.Pool,
): Promise<{ user: UserAccount; promotedToStaff: boolean }> {
  const hash = hashPassword(password);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [STAFF_BOOTSTRAP_LOCK.toString()]);
    const staffRes = await client.query("SELECT 1 FROM user_accounts WHERE is_staff = true LIMIT 1");
    const promotedToStaff = staffRes.rowCount === 0;
    const insertRes = await client.query(
      `INSERT INTO user_accounts (email, password_hash, display_name, is_staff)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, display_name, is_staff`,
      [email.toLowerCase().trim(), hash, displayName, promotedToStaff]
    );
    await client.query("COMMIT");
    return { user: insertRes.rows[0], promotedToStaff };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function findUserByEmail(email: string, pool: pg.Pool): Promise<(UserAccount & { password_hash: string }) | null> {
  const res = await pool.query(
    `SELECT id, email, display_name, is_staff, password_hash FROM user_accounts WHERE email = $1`,
    [email.toLowerCase().trim()]
  );
  return res.rowCount ? res.rows[0] : null;
}

export async function authenticate(email: string, password: string, pool: pg.Pool): Promise<UserAccount | null> {
  const row = await findUserByEmail(email, pool);
  if (!row) return null;
  if (!verifyPassword(password, row.password_hash)) return null;
  const { password_hash: _ph, ...user } = row;
  return user;
}

export async function createSession(userAccountId: string, pool: pg.Pool): Promise<{ cookieToken: string; sessionId: string }> {
  const cookieToken = generateToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const res = await pool.query(
    `INSERT INTO sessions (user_account_id, token_hash, expires_at) VALUES ($1, $2, $3) RETURNING id`,
    [userAccountId, sha256(cookieToken), expiresAt]
  );
  return { cookieToken, sessionId: res.rows[0].id };
}

export async function validateSession(cookieToken: string, pool: pg.Pool): Promise<SessionContext | null> {
  const hash = sha256(cookieToken);
  const res = await pool.query(
    `SELECT s.id AS sid, s.last_used_at,
            u.id, u.email, u.display_name, u.is_staff
     FROM sessions s
     JOIN user_accounts u ON u.id = s.user_account_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hash]
  );
  if (!res.rowCount) return null;
  const row = res.rows[0];

  const lastUsed = row.last_used_at ? new Date(row.last_used_at).getTime() : 0;
  if (Date.now() - lastUsed > 5 * 60 * 1000) {
    await pool.query(`UPDATE sessions SET last_used_at = now() WHERE id = $1`, [row.sid]);
  }

  const memberships = await pool.query<Membership>(
    `SELECT id, team_id, role FROM memberships WHERE user_account_id = $1 AND revoked_at IS NULL`,
    [row.id]
  );

  return {
    sessionId: row.sid,
    user: { id: row.id, email: row.email, display_name: row.display_name, is_staff: row.is_staff },
    memberships: memberships.rows,
  };
}

export async function revokeSession(sessionId: string, pool: pg.Pool): Promise<void> {
  await pool.query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
}

export async function resolveMembershipFromBearer(
  token: string,
  pool: pg.Pool
): Promise<{ id: string; teamId: string; role: string; userAccountId: string } | null> {
  const hash = sha256(token);
  const res = await pool.query(
    `SELECT id, team_id, role, user_account_id FROM memberships
     WHERE bearer_token_hash = $1 AND revoked_at IS NULL`,
    [hash]
  );
  if (!res.rowCount) return null;
  return {
    id: res.rows[0].id,
    teamId: res.rows[0].team_id,
    role: res.rows[0].role,
    userAccountId: res.rows[0].user_account_id,
  };
}
