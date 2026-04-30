import { readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export async function listAllSessionJsonls(root?: string): Promise<string[]> {
  const projectsRoot = root ?? join(homedir(), ".claude", "projects");
  const out: string[] = [];
  try {
    for (const project of readdirSync(projectsRoot)) {
      const dir = join(projectsRoot, project);
      try {
        for (const f of readdirSync(dir)) {
          if (f.endsWith(".jsonl")) out.push(join(dir, f));
        }
      } catch {
        // unreadable — skip
      }
    }
  } catch {
    // root missing — return empty
  }
  return out;
}
