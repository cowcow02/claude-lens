import { describe, it, expect } from "vitest";
import {
  PLAN_TIERS,
  PLAN_TIERS_IN_ORDER,
  tierEntry,
  nextTierUp,
  nextTierDown,
} from "../../src/lib/plan-tiers.js";

describe("plan-tiers catalog", () => {
  it("PLAN_TIERS has the four documented keys", () => {
    expect(Object.keys(PLAN_TIERS).sort()).toEqual(
      ["custom", "pro", "pro-max", "pro-max-20x"].sort(),
    );
  });

  it("dollar caps follow the public Anthropic price ladder", () => {
    expect(PLAN_TIERS.pro.monthlyPriceUsd).toBe(20);
    expect(PLAN_TIERS["pro-max"].monthlyPriceUsd).toBe(100);
    expect(PLAN_TIERS["pro-max-20x"].monthlyPriceUsd).toBe(200);
    expect(PLAN_TIERS.custom.monthlyPriceUsd).toBe(0);
  });

  it("PLAN_TIERS_IN_ORDER excludes custom and is rank-sorted", () => {
    expect(PLAN_TIERS_IN_ORDER.map((t) => t.key)).toEqual([
      "pro",
      "pro-max",
      "pro-max-20x",
    ]);
  });
});

describe("tierEntry", () => {
  it("returns the matching tier", () => {
    expect(tierEntry("pro-max").label).toBe("Claude Pro Max");
  });

  it("falls back to custom for unknown keys", () => {
    expect(tierEntry("enterprise").key).toBe("custom");
  });
});

describe("nextTierUp / nextTierDown", () => {
  it("walks the ladder up", () => {
    expect(nextTierUp("pro")?.key).toBe("pro-max");
    expect(nextTierUp("pro-max")?.key).toBe("pro-max-20x");
  });

  it("returns null at the top of the ladder", () => {
    expect(nextTierUp("pro-max-20x")).toBeNull();
  });

  it("walks the ladder down", () => {
    expect(nextTierDown("pro-max-20x")?.key).toBe("pro-max");
    expect(nextTierDown("pro-max")?.key).toBe("pro");
  });

  it("returns null at the bottom of the ladder", () => {
    expect(nextTierDown("pro")).toBeNull();
  });

  it("returns null for custom tier (no automated move)", () => {
    expect(nextTierUp("custom")).toBeNull();
    expect(nextTierDown("custom")).toBeNull();
  });
});
