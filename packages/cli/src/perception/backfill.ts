import { listEntriesForDay, readWeekDigest } from "@claude-lens/entries/fs";
import {
  readSettings, runWeekDigestPipeline, weekDates, shouldAutoFireWeek,
} from "@claude-lens/entries/node";

export type BackfillReason =
  | "ai_disabled"
  | "autofill_disabled"
  | "already_cached"
  | "already_fired_this_week"
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
 * Idempotent: shares the `~/.cclens/auto-week-fired-at` lock with the web's
 * /insights auto-fire so the two paths never double-spend.
 *
 * Best-effort: any error logs warn and returns `fired:false`. The daemon
 * does not crash on a failed backfill — user can always force-regen from
 * /insights to override the per-week lock.
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
  // The lock is consumed inside this call — once shouldAutoFireWeek returns
  // true it has already written `monday` to the file, so a second daemon
  // boot in the same week (or a /insights visit) sees `false`.
  if (!shouldAutoFireWeek(monday)) {
    log("info", `auto-backfill: skipped (already_fired_this_week)`);
    return { fired: false, reason: "already_fired_this_week", key: monday };
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
