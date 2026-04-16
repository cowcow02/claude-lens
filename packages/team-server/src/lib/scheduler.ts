import { getPool } from "../db/pool.js";

let started = false;

export function startScheduler(): void {
  if (started) return;
  started = true;

  // Check every hour, prune at 03:00 UTC
  setInterval(async () => {
    const now = new Date();
    if (now.getUTCHours() !== 3) return;
    // Only run once per hour window (minute 0-4)
    if (now.getUTCMinutes() > 4) return;

    try {
      const pool = getPool();
      const res = await pool.query(
        "DELETE FROM ingest_log WHERE received_at < now() - interval '24 hours'"
      );
      console.log(`[scheduler] pruned ${res.rowCount} ingest_log rows`);
    } catch (err) {
      console.error(`[scheduler] prune failed: ${(err as Error).message}`);
    }
  }, 60 * 60 * 1000); // every hour
}
