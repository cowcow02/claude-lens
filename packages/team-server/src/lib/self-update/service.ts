import { getPool } from "../../db/pool.js";
import { getLatestVersion } from "./version-detector.js";
import { getChangelog, getMigrationsManifest, type MigrationInfo } from "./changelog-fetcher.js";
import { getPlatformAdapter } from "./platform.js";

export interface UpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  lastCheckedAt: Date | null;
}

export async function getStatus(): Promise<UpdateStatus> {
  const pool = getPool();
  const { rows } = await pool.query(
    "SELECT current_version, latest_version, update_available, last_checked_at FROM update_check_cache WHERE key = 'global'",
  );
  const currentVersion = process.env.APP_VERSION ?? "0.0.0-dev";
  if (!rows.length) {
    return { currentVersion, latestVersion: null, updateAvailable: false, lastCheckedAt: null };
  }
  return {
    currentVersion,
    latestVersion: rows[0].latest_version,
    updateAvailable: rows[0].update_available,
    lastCheckedAt: rows[0].last_checked_at,
  };
}

export async function checkNow(): Promise<UpdateStatus> {
  const pool = getPool();
  const currentVersion = process.env.APP_VERSION ?? "0.0.0-dev";
  const latestVersion = await getLatestVersion();
  // "update available" iff latest > current, ignoring dev sentinel.
  const updateAvailable =
    !!latestVersion &&
    currentVersion !== "0.0.0-dev" &&
    (await import("semver")).gt(latestVersion, currentVersion);
  await pool.query(
    `INSERT INTO update_check_cache (key, current_version, latest_version, update_available, last_checked_at)
     VALUES ('global', $1, $2, $3, now())
     ON CONFLICT (key) DO UPDATE SET
       current_version = EXCLUDED.current_version,
       latest_version = EXCLUDED.latest_version,
       update_available = EXCLUDED.update_available,
       last_checked_at = now()`,
    [currentVersion, latestVersion, updateAvailable],
  );
  await pool.query(
    `INSERT INTO events (action, payload) VALUES ('self_update.check', $1)`,
    [JSON.stringify({ currentVersion, latestVersion })],
  );
  return { currentVersion, latestVersion, updateAvailable, lastCheckedAt: new Date() };
}

export async function getReview(
  version: string,
): Promise<{ changelog: string; migrations: MigrationInfo[] }> {
  const [changelog, manifest] = await Promise.all([
    getChangelog(version).catch(() => "*(Failed to fetch release notes.)*"),
    getMigrationsManifest(version).catch(() => ({ version, migrations: [] as MigrationInfo[] })),
  ]);
  return { changelog, migrations: manifest.migrations };
}

export async function applyUpdate(
  version: string,
  actorId: string,
): Promise<{ revisionId: string }> {
  const adapter = getPlatformAdapter();
  if (!adapter) throw new Error("Self-update is not available on this platform");
  const latest = await getLatestVersion();
  if (latest !== version)
    throw new Error(`Target version ${version} is no longer the latest (${latest ?? "unknown"})`);

  const pool = getPool();
  const currentVersion = process.env.APP_VERSION ?? "0.0.0-dev";
  await pool.query(
    `INSERT INTO events (actor_id, action, payload) VALUES ($1, 'self_update.apply_requested', $2)`,
    [actorId, JSON.stringify({ fromVersion: currentVersion, toVersion: version })],
  );

  const result = await adapter.redeploy(version);

  await pool.query(
    `UPDATE update_check_cache SET last_update_attempt = $1 WHERE key = 'global'`,
    [JSON.stringify({ version, revisionId: result.revisionId, at: new Date().toISOString() })],
  );

  return result;
}
