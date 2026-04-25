import "server-only";

export { listEntriesForDay, readDayDigest, writeDayDigest } from "@claude-lens/entries/fs";

export function toLocalDay(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function yesterdayLocal(nowMs: number = Date.now()): string {
  return toLocalDay(nowMs - 86_400_000);
}

export function todayLocal(nowMs: number = Date.now()): string {
  return toLocalDay(nowMs);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export function isValidDate(s: string): boolean {
  return DATE_RE.test(s);
}
