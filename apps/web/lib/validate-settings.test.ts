import { describe, expect, it } from "vitest";
import { SettingsUpdateSchema } from "./validate-settings";

describe("SettingsUpdateSchema", () => {
  it("accepts a well-formed Phase-2 body", () => {
    const body = {
      ai_features: { enabled: true, model: "sonnet", monthlyBudgetUsd: null },
    };
    expect(SettingsUpdateSchema.safeParse(body).success).toBe(true);
  });

  it("rejects non-boolean enabled", () => {
    const body = { ai_features: { enabled: "yes-please", model: "sonnet", monthlyBudgetUsd: null } };
    expect(SettingsUpdateSchema.safeParse(body).success).toBe(false);
  });

  it("rejects negative budget", () => {
    const body = { ai_features: { enabled: true, model: "sonnet", monthlyBudgetUsd: -5 } };
    expect(SettingsUpdateSchema.safeParse(body).success).toBe(false);
  });

  it("accepts null budget (unset)", () => {
    const body = { ai_features: { enabled: true, model: "sonnet", monthlyBudgetUsd: null } };
    expect(SettingsUpdateSchema.safeParse(body).success).toBe(true);
  });

  it("rejects missing ai_features", () => {
    expect(SettingsUpdateSchema.safeParse({}).success).toBe(false);
  });
});
