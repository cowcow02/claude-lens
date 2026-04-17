import { randomUUID } from "node:crypto";
import { dailyActivity, type DailyBucket, type SessionMeta } from "@claude-lens/parser";
import type { TeamConfig } from "./config.js";

export type DailyRollup = {
  day: string;
  agentTimeMs: number;
  sessions: number;
  toolCalls: number;
  turns: number;
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
};

export type IngestPayload = {
  ingestId: string;
  observedAt: string;
  dailyRollup: DailyRollup;
};

export function bucketToRollup(b: DailyBucket): DailyRollup {
  return {
    day: b.date,
    agentTimeMs: b.airTimeMs,
    sessions: b.sessions,
    toolCalls: b.toolCalls,
    turns: b.turns,
    tokens: { ...b.tokens },
  };
}

export function buildRollupsForRange(sessions: SessionMeta[], sinceDay?: string): DailyRollup[] {
  const buckets = dailyActivity(sessions);
  const kept = sinceDay ? buckets.filter((b) => b.date >= sinceDay) : buckets;
  return kept.map(bucketToRollup);
}

export function buildIngestPayload(rollup: DailyRollup): IngestPayload {
  return {
    ingestId: randomUUID(),
    observedAt: new Date().toISOString(),
    dailyRollup: rollup,
  };
}

export async function pushToTeamServer(
  config: TeamConfig,
  payload: IngestPayload,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetch(`${config.serverUrl}/api/ingest/metrics`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.bearerToken}`,
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body };
}
