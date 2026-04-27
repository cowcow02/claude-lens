import "server-only";
import { existsSync, readFileSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

function autoFireFile(): string {
  return process.env.CCLENS_AUTO_WEEK_FILE
    ?? join(homedir(), ".cclens", "auto-week-fired-at");
}

const MONDAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Returns true if this call is the one that should trigger auto-fire for `monday`.
 * Atomically updates the on-disk record so subsequent calls in the same ISO week
 * return false. Idempotent across server restarts.
 *
 * Corrupt/unreadable file is treated as "absent" — the caller will fire and
 * the file will be rewritten with a clean Monday line.
 */
export function shouldAutoFireWeek(monday: string): boolean {
  const file = autoFireFile();
  let prev: string | null = null;
  if (existsSync(file)) {
    try {
      const raw = readFileSync(file, "utf8").trim();
      if (MONDAY_RE.test(raw)) prev = raw;
    } catch { /* corrupt — treat as absent */ }
  }
  if (prev === monday) return false;

  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, monday + "\n", "utf8");
  renameSync(tmp, file);
  return true;
}
