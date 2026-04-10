import { describe, it, expect } from "vitest";
import { shouldUpdate } from "./updater.js";

describe("shouldUpdate", () => {
  it("returns true when remote is newer", () => {
    expect(shouldUpdate("0.1.0", "0.2.0")).toBe(true);
  });

  it("returns false when versions are equal", () => {
    expect(shouldUpdate("0.2.0", "0.2.0")).toBe(false);
  });

  it("returns false when local is newer", () => {
    expect(shouldUpdate("0.3.0", "0.2.0")).toBe(false);
  });

  it("handles patch versions", () => {
    expect(shouldUpdate("0.1.0", "0.1.1")).toBe(true);
    expect(shouldUpdate("0.1.1", "0.1.0")).toBe(false);
  });
});
