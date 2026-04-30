import { readFileSync, readdirSync, writeFileSync, mkdirSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { entryKey, parseEntryKey, type Entry, type EntryEnrichmentStatus } from "./types.js";

let entriesDirCached: string | null = null;

export function entriesDir(): string {
  if (entriesDirCached) return entriesDirCached;
  const envOverride = process.env.CCLENS_ENTRIES_DIR;
  entriesDirCached = envOverride ?? join(homedir(), ".cclens", "entries");
  return entriesDirCached;
}

/** @internal Test-only. Do not use in production. */
export function __setEntriesDirForTest(path: string): void {
  entriesDirCached = path;
  mkdirSync(path, { recursive: true });
}

function pathFor(sessionId: string, localDay: string): string {
  return join(entriesDir(), `${entryKey(sessionId, localDay)}.json`);
}

export function writeEntry(entry: Entry): void {
  const dir = entriesDir();
  mkdirSync(dir, { recursive: true });
  const final = pathFor(entry.session_id, entry.local_day);
  const tmp = `${final}.tmp`;
  const json = JSON.stringify(entry, null, 2);
  writeFileSync(tmp, json, { encoding: "utf8" });
  renameSync(tmp, final);
}

/**
 * Write a deterministic Entry rebuilt from JSONL while preserving any prior
 * committed enrichment on disk for the same (session_id, local_day) key.
 *
 * The perception sweep reconstructs Entries from raw events whenever a JSONL
 * file grows past its tracked checkpoint — or, more dramatically, whenever
 * `~/.cclens/perception-state.json` is reset and the sweep re-scans every
 * file from byte 0. In the reset case, `buildEntries` produces fresh Entries
 * with `enrichment: { status: "pending" }`. Plain `writeEntry` would clobber
 * the enriched-on-disk version, wiping the LLM cost the user already paid.
 *
 * This helper reads the existing entry first and:
 *   - If existing.enrichment.status is "done" or "skipped_trivial":
 *     keep that enrichment (the LLM work was committed and is keyed by
 *     the same `(session_id, local_day)` tuple).
 *   - Otherwise (pending / error / not-yet-existing):
 *     write the fresh entry as-is so a re-run can pick up where it left off.
 *
 * Deterministic facets (numbers, flags, signals, top_tools, etc.) always come
 * from the rebuilt entry — those reflect the latest JSONL state.
 */
const PRESERVABLE_STATUSES: ReadonlySet<EntryEnrichmentStatus> = new Set([
  "done", "skipped_trivial",
]);

export function writeEntryPreservingEnrichment(fresh: Entry): void {
  const existing = readEntry(fresh.session_id, fresh.local_day);
  if (existing && PRESERVABLE_STATUSES.has(existing.enrichment.status)) {
    writeEntry({ ...fresh, enrichment: existing.enrichment });
    return;
  }
  writeEntry(fresh);
}

export function readEntry(sessionId: string, localDay: string): Entry | null {
  const p = pathFor(sessionId, localDay);
  if (!existsSync(p)) return null;
  const raw = readFileSync(p, "utf8");
  return JSON.parse(raw) as Entry;
}

export function listEntryKeys(): string[] {
  const dir = entriesDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith(".json"))
    .map(f => f.slice(0, -".json".length));
}

export function listEntriesForDay(localDay: string): Entry[] {
  const out: Entry[] = [];
  for (const key of listEntryKeys()) {
    const parsed = parseEntryKey(key);
    if (!parsed || parsed.local_day !== localDay) continue;
    const e = readEntry(parsed.session_id, parsed.local_day);
    if (e) out.push(e);
  }
  return out;
}

export function listEntriesForSession(sessionId: string): Entry[] {
  const out: Entry[] = [];
  for (const key of listEntryKeys()) {
    const parsed = parseEntryKey(key);
    if (!parsed || parsed.session_id !== sessionId) continue;
    const e = readEntry(parsed.session_id, parsed.local_day);
    if (e) out.push(e);
  }
  return out;
}

export {
  writeDayDigest, readDayDigest,
  getTodayDigestFromCache, setTodayDigestInCache,
  writeWeekDigest, readWeekDigest, listWeekDigestKeys,
  getCurrentWeekDigestFromCache, setCurrentWeekDigestInCache,
  writeMonthDigest, readMonthDigest, listMonthDigestKeys,
  getCurrentMonthDigestFromCache, setCurrentMonthDigestInCache,
  __setDigestsDirForTest, __clearTodayCacheForTest,
} from "./digest-fs.js";

export function listEntriesWithStatus(statuses: EntryEnrichmentStatus[]): Entry[] {
  const set = new Set(statuses);
  const out: Entry[] = [];
  for (const key of listEntryKeys()) {
    const parsed = parseEntryKey(key);
    if (!parsed) continue;
    const e = readEntry(parsed.session_id, parsed.local_day);
    if (!e) continue;
    if (set.has(e.enrichment.status)) out.push(e);
  }
  out.sort((a, b) => a.local_day.localeCompare(b.local_day)
    || a.session_id.localeCompare(b.session_id));
  return out;
}

