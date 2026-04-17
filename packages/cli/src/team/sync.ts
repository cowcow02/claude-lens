import { readTeamConfig, writeTeamConfig, type TeamConfig } from "./config.js";
import { buildIngestPayload, buildRollupsForRange, pushToTeamServer, type IngestPayload } from "./push.js";
import { enqueuePayload, dequeuePayloads } from "./queue.js";

type LogFn = (level: "info" | "warn" | "error", message: string) => void;

const noopLog: LogFn = () => {};

export type SyncOutcome = {
  paired: boolean;
  pushed: number;
  queued: number;
  queuedDrained: number;
  failedDay?: string;
  error?: string;
};

export async function runTeamSync(log: LogFn = noopLog): Promise<SyncOutcome> {
  const config = readTeamConfig();
  if (!config) return { paired: false, pushed: 0, queued: 0, queuedDrained: 0 };

  try {
    const { listSessions } = await import("@claude-lens/parser/fs");
    const { toLocalDay } = await import("@claude-lens/parser");
    const today = toLocalDay(Date.now());

    const sessions = await listSessions({ limit: 10_000 });
    const rollups = buildRollupsForRange(sessions, config.lastSyncedDay);

    if (rollups.length === 0) {
      log("info", "team push: nothing to sync");
      return { paired: true, pushed: 0, queued: 0, queuedDrained: 0 };
    }

    let pushed = 0;
    let queued = 0;
    let failedDay: string | undefined;

    for (const rollup of rollups) {
      const payload = buildIngestPayload(rollup);
      const result = await pushToTeamServer(config, payload);
      if (!result.ok) {
        log("warn", `team push failed on ${rollup.day} (${result.status}); queueing`);
        enqueuePayload(payload);
        queued++;
        failedDay = rollup.day;
        break;
      }
      pushed++;
    }

    const nextConfig: TeamConfig = { ...config, lastSyncedDay: today };
    if (pushed > 0 || !failedDay) writeTeamConfig(nextConfig);

    let queuedDrained = 0;
    if (!failedDay) {
      const backlog = dequeuePayloads() as IngestPayload[];
      for (let i = 0; i < backlog.length; i++) {
        const qResult = await pushToTeamServer(config, backlog[i]);
        if (!qResult.ok) {
          for (const remaining of backlog.slice(i)) enqueuePayload(remaining);
          break;
        }
        queuedDrained++;
      }
    }

    if (pushed > 0) {
      log("info", `team push ok: ${pushed} day${pushed === 1 ? "" : "s"} pushed` +
        (queuedDrained ? `, ${queuedDrained} queued retried` : "") +
        (queued ? `, ${queued} queued for retry` : ""));
    }

    return { paired: true, pushed, queued, queuedDrained, failedDay };
  } catch (err) {
    const message = (err as Error).message;
    log("warn", `team push error: ${message}`);
    return { paired: true, pushed: 0, queued: 0, queuedDrained: 0, error: message };
  }
}
