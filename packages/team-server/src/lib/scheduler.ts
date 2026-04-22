import { getPool } from "../db/pool";

export async function pruneIngestLog(): Promise<number> {
  const res = await getPool().query(
    "DELETE FROM ingest_log WHERE received_at < now() - interval '24 hours'"
  );
  return res.rowCount ?? 0;
}

let started = false;

export function startScheduler(): void {
  if (started) return;
  if (process.env.FLEETLENS_EXTERNAL_SCHEDULER === "1") return;
  started = true;

  setInterval(async () => {
    try {
      const n = await pruneIngestLog();
      if (n) console.log(`[scheduler] pruned ${n} ingest_log rows`);
    } catch (err) {
      console.error(`[scheduler] prune failed: ${(err as Error).message}`);
    }
  }, 60 * 60 * 1000);
}
