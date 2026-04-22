import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, statSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readSettings,
  writeSettings,
  __setSettingsPathForTest,
  type Settings,
} from "../src/settings.js";

describe("settings", () => {
  let path: string;

  beforeEach(() => {
    const tmp = mkdtempSync(join(tmpdir(), "settings-"));
    path = join(tmp, "settings.json");
    __setSettingsPathForTest(path);
  });

  it("readSettings returns defaults when file does not exist", () => {
    const s = readSettings();
    expect(s.ai_features.enabled).toBe(false);
    expect(s.ai_features.model).toBe("sonnet");
    expect(s.ai_features.allowedProjects).toEqual([]);
    expect(s.ai_features.monthlyBudgetUsd).toBeNull();
  });

  it("writeSettings persists JSON atomically with snake_case on-disk shape + chmod 600", () => {
    const s: Settings = {
      ai_features: {
        enabled: true,
        model: "sonnet",
        allowedProjects: ["/Users/test/foo"],
        monthlyBudgetUsd: 5,
      },
    };
    writeSettings(s);
    expect(existsSync(path)).toBe(true);
    const raw = readFileSync(path, "utf8");
    expect(JSON.parse(raw)).toEqual({
      ai_features: {
        enabled: true,
        model: "sonnet",
        allowed_projects: ["/Users/test/foo"],
        monthly_budget_usd: 5,
      },
    });
    if (process.platform !== "win32") {
      const mode = statSync(path).mode & 0o777;
      expect(mode).toBe(0o600);
    }
  });

  it("round-trips: writeSettings then readSettings returns the same shape", () => {
    const original: Settings = {
      ai_features: {
        enabled: true,
        model: "opus",
        allowedProjects: ["/a", "/b"],
        monthlyBudgetUsd: 10.5,
      },
    };
    writeSettings(original);
    expect(readSettings()).toEqual(original);
  });

  it("tolerates malformed JSON by returning defaults", () => {
    writeFileSync(path, "{not json");
    const s = readSettings();
    expect(s.ai_features.enabled).toBe(false);
  });
});
