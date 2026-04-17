import type pg from "pg";
import { getPool } from "../db/pool";

export async function getBootstrapState(
  pool: pg.Pool = getPool(),
): Promise<{ hash: string; expiresAt: Date } | null> {
  const res = await pool.query(
    "SELECT value, expires_at FROM server_config WHERE key = 'bootstrap_hash'"
  );
  if (!res.rowCount) return null;
  return { hash: res.rows[0].value, expiresAt: new Date(res.rows[0].expires_at) };
}

export async function setBootstrapState(
  hash: string,
  expiresAt: Date,
  pool: pg.Pool = getPool(),
): Promise<void> {
  await pool.query(
    `INSERT INTO server_config (key, value, expires_at) VALUES ('bootstrap_hash', $1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at`,
    [hash, expiresAt]
  );
}

export async function clearBootstrapState(pool: pg.Pool = getPool()): Promise<void> {
  await pool.query("DELETE FROM server_config WHERE key = 'bootstrap_hash'");
}
