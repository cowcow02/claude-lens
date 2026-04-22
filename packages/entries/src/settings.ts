import {
  readFileSync, writeFileSync, renameSync, chmodSync, mkdirSync, existsSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export type AiFeaturesSettings = {
  enabled: boolean;
  model: string;
  allowedProjects: string[];
  monthlyBudgetUsd: number | null;
};

export type Settings = {
  ai_features: AiFeaturesSettings;
};

const DEFAULT_SETTINGS: Settings = {
  ai_features: {
    enabled: false,
    model: "sonnet",
    allowedProjects: [],
    monthlyBudgetUsd: null,
  },
};

let settingsPathCached: string | null = null;

function settingsPath(): string {
  if (settingsPathCached) return settingsPathCached;
  settingsPathCached = join(homedir(), ".cclens", "settings.json");
  return settingsPathCached;
}

/** @internal Test-only. */
export function __setSettingsPathForTest(path: string): void {
  settingsPathCached = path;
}

/** On-disk shape uses snake_case; in-memory shape uses camelCase. */
type SettingsOnDisk = {
  ai_features: {
    enabled: boolean;
    model: string;
    allowed_projects: string[];
    monthly_budget_usd: number | null;
  };
};

function toDisk(s: Settings): SettingsOnDisk {
  return {
    ai_features: {
      enabled: s.ai_features.enabled,
      model: s.ai_features.model,
      allowed_projects: s.ai_features.allowedProjects,
      monthly_budget_usd: s.ai_features.monthlyBudgetUsd,
    },
  };
}

function fromDisk(d: Partial<SettingsOnDisk>): Settings {
  const af: Partial<SettingsOnDisk["ai_features"]> = d.ai_features ?? {};
  return {
    ai_features: {
      enabled: af.enabled ?? DEFAULT_SETTINGS.ai_features.enabled,
      model: af.model ?? DEFAULT_SETTINGS.ai_features.model,
      allowedProjects: af.allowed_projects ?? [],
      monthlyBudgetUsd: af.monthly_budget_usd ?? null,
    },
  };
}

export function readSettings(): Settings {
  const p = settingsPath();
  if (!existsSync(p)) return DEFAULT_SETTINGS;
  try {
    const raw = readFileSync(p, "utf8");
    return fromDisk(JSON.parse(raw) as Partial<SettingsOnDisk>);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function writeSettings(s: Settings): void {
  const p = settingsPath();
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(toDisk(s), null, 2), { encoding: "utf8" });
  if (process.platform !== "win32") {
    chmodSync(tmp, 0o600);
  }
  renameSync(tmp, p);
}
