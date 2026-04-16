import { sha256, generateToken } from "./crypto.js";
import type pg from "pg";

export function hashToken(token: string): string {
  return sha256(token);
}

export function validateBearerToken(token: string, storedHash: string): boolean {
  return sha256(token) === storedHash;
}

export async function resolveMemberFromToken(
  token: string,
  pool: pg.Pool
): Promise<{ id: string; teamId: string; role: string } | null> {
  const hash = sha256(token);
  const res = await pool.query(
    `SELECT id, team_id, role FROM members WHERE bearer_token_hash = $1 AND revoked_at IS NULL`,
    [hash]
  );
  if (res.rowCount === 0) return null;
  return { id: res.rows[0].id, teamId: res.rows[0].team_id, role: res.rows[0].role };
}

export async function createAdminSession(
  memberId: string,
  pool: pg.Pool
): Promise<{ sessionId: string; cookieToken: string }> {
  const cookieToken = generateToken(32);
  const hash = sha256(cookieToken);
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
  const res = await pool.query(
    `INSERT INTO admin_sessions (member_id, token_hash, expires_at) VALUES ($1, $2, $3) RETURNING id`,
    [memberId, hash, expiresAt]
  );
  return { sessionId: res.rows[0].id, cookieToken };
}

export async function validateAdminSession(
  cookieToken: string,
  pool: pg.Pool
): Promise<{ memberId: string; sessionId: string } | null> {
  const hash = sha256(cookieToken);
  const res = await pool.query(
    `SELECT s.id, s.member_id FROM admin_sessions s
     JOIN members m ON s.member_id = m.id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND m.revoked_at IS NULL`,
    [hash]
  );
  if (res.rowCount === 0) return null;
  await pool.query(`UPDATE admin_sessions SET last_used_at = now() WHERE id = $1`, [res.rows[0].id]);
  return { memberId: res.rows[0].member_id, sessionId: res.rows[0].id };
}

export function generateBootstrapToken(): { token: string; hash: string; expiresAt: Date } {
  const token = [generateToken(2), generateToken(2), generateToken(2), generateToken(2)].join("-");
  return {
    token,
    hash: sha256(token),
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  };
}

export function validateBootstrapToken(token: string, storedHash: string, expiresAt: Date): boolean {
  if (new Date() > expiresAt) return false;
  return sha256(token) === storedHash;
}
