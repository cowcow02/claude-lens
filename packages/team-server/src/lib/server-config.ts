import type pg from "pg";
import { getPool } from "../db/pool";

export async function getConfig(key: string, pool: pg.Pool = getPool()): Promise<string | null> {
  const res = await pool.query("SELECT value FROM server_config WHERE key = $1", [key]);
  return res.rowCount ? res.rows[0].value : null;
}

export async function setConfig(key: string, value: string, pool: pg.Pool = getPool()): Promise<void> {
  await pool.query(
    `INSERT INTO server_config (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, value]
  );
}

export async function getBool(key: string, def: boolean, pool: pg.Pool = getPool()): Promise<boolean> {
  const v = await getConfig(key, pool);
  if (v === null) return def;
  return v === "true";
}

export async function instanceState(pool: pg.Pool = getPool()): Promise<{
  hasAnyUser: boolean;
  hasAnyTeam: boolean;
  allowPublicSignup: boolean;
  allowMultipleTeams: boolean;
}> {
  const [userRes, teamRes] = await Promise.all([
    pool.query("SELECT 1 FROM user_accounts LIMIT 1"),
    pool.query("SELECT 1 FROM teams LIMIT 1"),
  ]);
  const allowPublicSignup = await getBool("allow_public_signup", false, pool);
  const allowMultipleTeams = await getBool("allow_multiple_teams", false, pool);
  return {
    hasAnyUser: (userRes.rowCount ?? 0) > 0,
    hasAnyTeam: (teamRes.rowCount ?? 0) > 0,
    allowPublicSignup,
    allowMultipleTeams,
  };
}

export async function canCreateTeam(pool: pg.Pool = getPool()): Promise<boolean> {
  const state = await instanceState(pool);
  if (!state.hasAnyTeam) return true;
  return state.allowMultipleTeams;
}
