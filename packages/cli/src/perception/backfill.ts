import { listEntriesForDay, readWeekDigest } from "@claude-lens/entries/fs";
import {
  readSettings, runWeekDigestPipeline, weekDates, interactiveLockFresh,
} from "@claude-lens/entries/node";

export type BackfillReason =
  | "ai_disabled"
  | "autofill_disabled"
  | "already_cached"
  | "in_flight"
  | "no_entries"
  | "ok";

export type BackfillResult = {
  fired: boolean;
  reason: BackfillReason;
  /** Monday of the targeted week (YYYY-MM-DD), present when computable. */
  key?: string;
};

export type BackfillLogger = (level: "info" | "warn" | "error", msg: string) => void;

export type BackfillOptions = {
  now?: number;
  log?: BackfillLogger;
  /** Hook for tests to drive a synthetic pipeline instead of `runWeekDigestPipeline`. */
  runPipeline?: typeof runWeekDigestPipeline;
};

function toLocalDay(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function mondayOf(localDay: string): string {
  const d = new Date(`${localDay}T00:00:00`);
  const dow = d.getDay(); // 0=Sun, 1=Mon, ...
  const offset = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + offset);
  return toLocalDay(d.getTime());
}

/** Most recent COMPLETED ISO week — last week's Monday. */
export function lastCompletedWeekMonday(nowMs: number = Date.now()): string {
  const thisMonday = mondayOf(toLocalDay(nowMs));
  const d = new Date(`${thisMonday}T00:00:00`);
  d.setDate(d.getDate() - 7);
  return toLocalDay(d.getTime());
}

/**
 * Boot-time backfill of the most recently completed ISO week's narrative.
 *
 * "Already done?" is answered by the digest file on disk; "currently running?"
 * by the heartbeat-refreshed interactive pipeline lock. No standalone fire-
 * once-per-week file: a half-completed run leaves no digest and no fresh
 * lock, so the next caller (daemon boot, /insights visit) retries naturally.
 *
 * Best-effort: pipeline errors log warn but never crash the daemon.
 */
export async function backfillLastWeekDigest(
  opts: BackfillOptions = {},
): Promise<BackfillResult> {
  const log = opts.log ?? (() => {});
  const now = opts.now ?? Date.now();
  const monday = lastCompletedWeekMonday(now);
  const todayLocalDay = toLocalDay(now);
  const currentWeekMonday = mondayOf(todayLocalDay);

  const settings = readSettings();
  if (!settings.ai_features.enabled) {
    log("info", `auto-backfill: skipped (ai_disabled)`);
    return { fired: false, reason: "ai_disabled", key: monday };
  }
  if (!settings.ai_features.autoBackfillLastWeek) {
    log("info", `auto-backfill: skipped (autofill_disabled)`);
    return { fired: false, reason: "autofill_disabled", key: monday };
  }
  if (readWeekDigest(monday)) {
    log("info", `auto-backfill: skipped (already_cached)`);
    return { fired: false, reason: "already_cached", key: monday };
  }
  if (!weekDates(monday).some((d) => listEntriesForDay(d).length > 0)) {
    log("info", `auto-backfill: skipped (no_entries)`);
    return { fired: false, reason: "no_entries", key: monday };
  }
  if (interactiveLockFresh(now)) {
    log("info", `auto-backfill: skipped (in_flight)`);
    return { fired: false, reason: "in_flight", key: monday };
  }

  log("info", `auto-backfill: fired week-${monday}`);
  try {
    const run = opts.runPipeline ?? runWeekDigestPipeline;
    for await (const ev of run(monday, {
      settings: settings.ai_features,
      currentWeekMonday,
      todayLocalDay,
      caller: "daemon",
    })) {
      if (ev.type === "saved") log("info", `auto-backfill: ${ev.path}`);
      else if (ev.type === "error") log("warn", `auto-backfill: pipeline error — ${ev.message}`);
    }
  } catch (err) {
    log("warn", `auto-backfill: failed (${(err as Error).message})`);
  }
  return { fired: true, reason: "ok", key: monday };
}
