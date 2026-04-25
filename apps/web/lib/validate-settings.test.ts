import { describe, expect, it } from "vitest";
import { SettingsUpdateSchema } from "./validate-settings";

describe("SettingsUpdateSchema", () => {
  it("accepts a well-formed body", () => {
    const body = { ai_features: { enabled: true } };
    expect(SettingsUpdateSchema.safeParse(body).success).toBe(true);
  });

  it("rejects non-boolean enabled", () => {
    const body = { ai_features: { enabled: "yes-please" } };
    expect(SettingsUpdateSchema.safeParse(body).success).toBe(false);
  });

  it("rejects missing ai_features", () => {
    expect(SettingsUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("tolerates extra fields on ai_features (extracts only enabled)", () => {
    const body = { ai_features: { enabled: true, monthlyBudgetUsd: 10, model: "sonnet" } };
    const r = SettingsUpdateSchema.safeParse(body);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.ai_features.enabled).toBe(true);
  });
});
