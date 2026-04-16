import { randomUUID } from "node:crypto";
import type { SessionMeta } from "@claude-lens/parser";
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

export function buildDailyRollup(sessions: SessionMeta[], day: string): DailyRollup {
  let agentTimeMs = 0;
  let toolCalls = 0;
  let turns = 0;
  let tokensInput = 0;
  let tokensOutput = 0;
  let tokensCacheRead = 0;
  let tokensCacheWrite = 0;

  for (const s of sessions) {
    agentTimeMs += s.airTimeMs ?? 0;
    toolCalls += s.toolCallCount ?? 0;
    turns += s.turnCount ?? 0;
    if (s.totalUsage) {
      tokensInput += s.totalUsage.input ?? 0;
      tokensOutput += s.totalUsage.output ?? 0;
      tokensCacheRead += s.totalUsage.cacheRead ?? 0;
      tokensCacheWrite += s.totalUsage.cacheWrite ?? 0;
    }
  }

  return {
    day,
    agentTimeMs,
    sessions: sessions.length,
    toolCalls,
    turns,
    tokens: {
      input: tokensInput,
      output: tokensOutput,
      cacheRead: tokensCacheRead,
      cacheWrite: tokensCacheWrite,
    },
  };
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
