import { describe, expect, it, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSettings, writeSettings, __setSettingsPathForTest } from "../src/settings.js";

describe("settings defaults (Phase 2 flip)", () => {
  let tmp: string;
  let settingsPath: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "settings-"));
    settingsPath = join(tmp, "settings.json");
    __setSettingsPathForTest(settingsPath);
  });

  it("fresh install returns enabled:true", () => {
    const s = readSettings();
    expect(s.ai_features.enabled).toBe(true);
    expect(s.ai_features.model).toBe("sonnet");
    expect(s.ai_features.monthlyBudgetUsd).toBeNull();
  });

  it("has no allowedProjects field on the returned shape", () => {
    const s = readSettings();
    expect("allowedProjects" in s.ai_features).toBe(false);
  });

  it("drops allowed_projects on round-trip", () => {
    writeFileSync(settingsPath, JSON.stringify({
      ai_features: {
        enabled: false, model: "opus",
        allowed_projects: ["/foo"],
        monthly_budget_usd: 10,
      },
    }));
    const s = readSettings();
    expect(s.ai_features.enabled).toBe(false);
    expect(s.ai_features.model).toBe("opus");
    expect(s.ai_features.monthlyBudgetUsd).toBe(10);
    expect("allowedProjects" in s.ai_features).toBe(false);

    writeSettings(s);
    const roundtripped = JSON.parse(readFileSync(settingsPath, "utf8"));
    expect("allowed_projects" in roundtripped.ai_features).toBe(false);
  });
});
