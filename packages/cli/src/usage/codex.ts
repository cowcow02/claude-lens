/**
 * Codex usage poller.
 *
 * Codex CLI writes its rate-limit windows directly into every rollout
 * JSONL (under `rate_limits.{primary,secondary}` on each token_count
 * event), so observation is just "read the latest rollout's last
 * token_count" — no API call, no auth, no network.
 *
 * The result is shaped as the same UsageSnapshot used by the Claude
 * poller so the daemon's append path and the web's reader stay agent-
 * generic. Codex doesn't emit per-model 7d windows, so those fields
 * are null.
 */

import { getLatestCodexUsage } from "@claude-lens/parser/fs";
import type { UsageSnapshot } from "./api.js";

export type CodexPollResult =
  | { kind: "ok"; snapshot: UsageSnapshot }
  | { kind: "no_sessions" };

export async function pollCodexUsage(): Promise<CodexPollResult> {
  const windows = await getLatestCodexUsage();
  if (!windows) return { kind: "no_sessions" };
  const snapshot: UsageSnapshot = {
    captured_at: new Date().toISOString(),
    agent: "codex",
    five_hour: windows.five_hour,
    seven_day: windows.seven_day,
    seven_day_opus: null,
    seven_day_sonnet: null,
    seven_day_oauth_apps: null,
    seven_day_cowork: null,
    extra_usage: null,
    plan_type: windows.plan_type,
  };
  return { kind: "ok", snapshot };
}
