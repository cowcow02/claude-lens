import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "../../src/lib/password.js";

describe("hashPassword", () => {
  it("returns a scrypt$ prefixed string", () => {
    const h = hashPassword("hunter2");
    expect(h).toMatch(/^scrypt\$16384\$8\$1\$/);
  });

  it("includes 6 dollar-sign delimited segments", () => {
    const h = hashPassword("password123");
    expect(h.split("$")).toHaveLength(6);
  });

  it("produces different hashes each call (random salt)", () => {
    const a = hashPassword("samepassword");
    const b = hashPassword("samepassword");
    expect(a).not.toBe(b);
  });
});

describe("verifyPassword", () => {
  it("verifies a correct password", () => {
    const h = hashPassword("correcthorse");
    expect(verifyPassword("correcthorse", h)).toBe(true);
  });

  it("rejects a wrong password", () => {
    const h = hashPassword("correcthorse");
    expect(verifyPassword("wrongpassword", h)).toBe(false);
  });

  it("returns false for a malformed stored string", () => {
    expect(verifyPassword("anything", "not-a-valid-hash")).toBe(false);
  });

  it("returns false when segment count is wrong", () => {
    expect(verifyPassword("pw", "scrypt$1$2$3$abc")).toBe(false);
  });

  it("normalises unicode (NFKC) — composed and decomposed forms match", () => {
    // "\u00e9" === composed é, "\u0065\u0301" === decomposed e + combining accent
    const composed = "\u00e9";
    const decomposed = "\u0065\u0301";
    const h = hashPassword(composed);
    expect(verifyPassword(decomposed, h)).toBe(true);
  });
});
