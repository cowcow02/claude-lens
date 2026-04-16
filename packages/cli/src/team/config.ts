import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const DEFAULT_DIR = join(homedir(), ".cclens");
const CONFIG_FILE = "team.json";

export type TeamConfig = {
  serverUrl: string;
  memberId: string;
  bearerToken: string;
  teamSlug: string;
  pairedAt: string;
};

export function readTeamConfig(dir = DEFAULT_DIR): TeamConfig | null {
  try {
    return JSON.parse(readFileSync(join(dir, CONFIG_FILE), "utf8"));
  } catch {
    return null;
  }
}

export function writeTeamConfig(config: TeamConfig, dir = DEFAULT_DIR): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, CONFIG_FILE), JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function clearTeamConfig(dir = DEFAULT_DIR): void {
  try { unlinkSync(join(dir, CONFIG_FILE)); } catch {}
}
