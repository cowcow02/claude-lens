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

  it("readSettings returns Phase-2 defaults when file does not exist", () => {
    const s = readSettings();
    expect(s.ai_features.enabled).toBe(true);
    expect(s.ai_features.model).toBe("sonnet");
    expect(s.ai_features.monthlyBudgetUsd).toBeNull();
  });

  it("writeSettings persists JSON atomically with snake_case on-disk shape + chmod 600", () => {
    const s: Settings = {
      ai_features: {
        enabled: true,
        model: "sonnet",
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
        enabled: false,
        model: "opus",
        monthlyBudgetUsd: 10.5,
      },
    };
    writeSettings(original);
    expect(readSettings()).toEqual(original);
  });

  it("tolerates malformed JSON by returning defaults (enabled=true per Phase 2)", () => {
    writeFileSync(path, "{not json");
    const s = readSettings();
    expect(s.ai_features.enabled).toBe(true);
  });
});
