import { describe, it, expect } from "vitest";
import { isTrivial } from "../src/trivial.js";

describe("isTrivial", () => {
  it("returns true when all three thresholds miss", () => {
    expect(isTrivial({ active_min: 0.5, turn_count: 2, tools_total: 0 })).toBe(true);
  });
  it("returns false when active_min is ≥ 1", () => {
    expect(isTrivial({ active_min: 1.2, turn_count: 2, tools_total: 0 })).toBe(false);
  });
  it("returns false when tools_total is ≥ 1", () => {
    expect(isTrivial({ active_min: 0.3, turn_count: 1, tools_total: 5 })).toBe(false);
  });
  it("returns false when turn_count is ≥ 3", () => {
    expect(isTrivial({ active_min: 0.2, turn_count: 3, tools_total: 0 })).toBe(false);
  });
});
