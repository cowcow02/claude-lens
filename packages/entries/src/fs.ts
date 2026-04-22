import { readFileSync, readdirSync, writeFileSync, mkdirSync, renameSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { entryKey, parseEntryKey, type Entry, type EntryEnrichmentStatus } from "./types.js";

let entriesDirCached: string | null = null;

export function entriesDir(): string {
  if (entriesDirCached) return entriesDirCached;
  entriesDirCached = join(homedir(), ".cclens", "entries");
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

/** Unique project values across all Entries on disk, sorted.
 *  Used by the Settings "AI Features" page to populate the allowlist.
 *  O(n) JSON parse over every Entry — acceptable at ≲1000 entries;
 *  revisit with a sidecar index if scale exceeds 10k. */
export function listKnownProjects(): string[] {
  const seen = new Set<string>();
  for (const key of listEntryKeys()) {
    const parsed = parseEntryKey(key);
    if (!parsed) continue;
    const e = readEntry(parsed.session_id, parsed.local_day);
    if (e) seen.add(e.project);
  }
  return [...seen].sort();
}
