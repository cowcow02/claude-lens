import { describe, it, expect } from "vitest";
import { generateToken, sha256, encryptAesGcm, decryptAesGcm } from "../../src/lib/crypto.js";
import { randomBytes } from "node:crypto";

describe("generateToken", () => {
  it("returns 64-char hex string by default (32 bytes)", () => {
    expect(generateToken()).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns 32-char hex string for 16 bytes", () => {
    expect(generateToken(16)).toMatch(/^[0-9a-f]{32}$/);
  });

  it("produces different values on successive calls", () => {
    expect(generateToken()).not.toBe(generateToken());
  });
});

describe("sha256", () => {
  it("returns known hash for 'hello'", () => {
    expect(sha256("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    );
  });

  it("is deterministic", () => {
    expect(sha256("test")).toBe(sha256("test"));
  });
});

describe("encryptAesGcm / decryptAesGcm", () => {
  const key = randomBytes(32).toString("hex");

  it("round-trips plaintext", () => {
    const plaintext = "hello, world";
    expect(decryptAesGcm(encryptAesGcm(plaintext, key), key)).toBe(plaintext);
  });

  it("throws with wrong key", () => {
    const encrypted = encryptAesGcm("secret", key);
    const wrongKey = randomBytes(32).toString("hex");
    expect(() => decryptAesGcm(encrypted, wrongKey)).toThrow();
  });

  it("throws with tampered ciphertext", () => {
    const encrypted = encryptAesGcm("secret", key);
    const parts = encrypted.split(":");
    // flip a byte in the ciphertext
    parts[1] = parts[1].slice(0, -2) + (parts[1].slice(-2) === "ff" ? "00" : "ff");
    expect(() => decryptAesGcm(parts.join(":"), key)).toThrow();
  });
});
