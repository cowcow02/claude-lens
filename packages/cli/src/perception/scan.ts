import { readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/** Enumerate all Claude Code session JSONL paths under ~/.claude/projects/. */
export async function listAllSessionJsonls(): Promise<string[]> {
  const root = join(homedir(), ".claude", "projects");
  const out: string[] = [];
  try {
    for (const project of readdirSync(root)) {
      const dir = join(root, project);
      try {
        for (const f of readdirSync(dir)) {
          if (f.endsWith(".jsonl")) out.push(join(dir, f));
        }
      } catch {
        // Directory unreadable or not a directory — skip.
      }
    }
  } catch {
    // ~/.claude/projects missing entirely.
  }
  return out;
}
