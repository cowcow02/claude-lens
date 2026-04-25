import { readFileSync, writeFileSync, renameSync, chmodSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { DayDigest } from "./types.js";

let digestsDirCached: string | null = null;

function digestsDir(): string {
  if (digestsDirCached) return digestsDirCached;
  const envOverride = process.env.CCLENS_DIGESTS_DIR;
  digestsDirCached = envOverride ?? join(homedir(), ".cclens", "digests");
  return digestsDirCached;
}

/** @internal Test-only. */
export function __setDigestsDirForTest(path: string): void {
  digestsDirCached = path;
  mkdirSync(join(path, "day"), { recursive: true });
}

function dayDigestPath(date: string): string {
  return join(digestsDir(), "day", `${date}.json`);
}

export function writeDayDigest(digest: DayDigest): void {
  const final = dayDigestPath(digest.key);
  mkdirSync(dirname(final), { recursive: true });
  const tmp = `${final}.tmp`;
  writeFileSync(tmp, JSON.stringify(digest, null, 2), "utf8");
  if (process.platform !== "win32") {
    try { chmodSync(tmp, 0o600); } catch { /* best-effort */ }
  }
  renameSync(tmp, final);
}

export function readDayDigest(date: string): DayDigest | null {
  const p = dayDigestPath(date);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as DayDigest;
  } catch {
    return null;
  }
}

// ─── Today's digest: in-memory TTL cache (10 minutes) ─────────────────────

type TodayCacheEntry = { date: string; digest: DayDigest; writtenAtMs: number };
const TODAY_TTL_MS = 10 * 60 * 1000;
let todayCache: TodayCacheEntry | null = null;

export function getTodayDigestFromCache(date: string, nowMs: number): DayDigest | null {
  if (!todayCache) return null;
  if (todayCache.date !== date) return null;
  if (nowMs - todayCache.writtenAtMs > TODAY_TTL_MS) return null;
  return todayCache.digest;
}

export function setTodayDigestInCache(date: string, digest: DayDigest, nowMs: number): void {
  todayCache = { date, digest, writtenAtMs: nowMs };
}

/** @internal Test-only. */
export function __clearTodayCacheForTest(): void {
  todayCache = null;
}
