import { describe, it, expect } from "vitest";
import {
  hashToken,
  validateBearerToken,
  generateBootstrapToken,
  validateBootstrapToken,
} from "../../src/lib/auth.js";

describe("hashToken", () => {
  it("returns a 64-char hex string", () => {
    const hash = hashToken("sometoken");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });
});

describe("validateBearerToken", () => {
  it("returns true for matching token", () => {
    const token = "test-token-abc";
    const hash = hashToken(token);
    expect(validateBearerToken(token, hash)).toBe(true);
  });

  it("returns false for wrong token", () => {
    const hash = hashToken("correct-token");
    expect(validateBearerToken("wrong-token", hash)).toBe(false);
  });
});

describe("generateBootstrapToken", () => {
  it("returns token in xxxx-xxxx-xxxx-xxxx format", () => {
    const { token, hash, expiresAt } = generateBootstrapToken();
    expect(token).toMatch(/^[0-9a-f]+-[0-9a-f]+-[0-9a-f]+-[0-9a-f]+$/);
    expect(hash).toHaveLength(64);
    expect(expiresAt).toBeInstanceOf(Date);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("validateBootstrapToken", () => {
  it("returns true for valid token within TTL", () => {
    const { token, hash, expiresAt } = generateBootstrapToken();
    expect(validateBootstrapToken(token, hash, expiresAt)).toBe(true);
  });

  it("returns false for expired token", () => {
    const { token, hash } = generateBootstrapToken();
    const expired = new Date(Date.now() - 1000);
    expect(validateBootstrapToken(token, hash, expired)).toBe(false);
  });

  it("returns false for wrong token", () => {
    const { hash, expiresAt } = generateBootstrapToken();
    expect(validateBootstrapToken("wrong-token", hash, expiresAt)).toBe(false);
  });
});
