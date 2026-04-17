import { describe, it, expect } from "vitest";
import { rateLimit, clientKey } from "../../src/lib/rate-limit.js";

// Each test uses a unique key prefix to avoid cross-test bucket pollution
let keyCounter = 0;
function uniqueKey(label: string): string {
  return `test:${label}:${++keyCounter}:${Math.random().toString(36).slice(2)}`;
}

describe("rateLimit", () => {
  it("allows requests under the limit", () => {
    const key = uniqueKey("under");
    for (let i = 0; i < 5; i++) {
      expect(rateLimit(key, 10, 60_000).allowed).toBe(true);
    }
  });

  it("blocks the request that exceeds the limit", () => {
    const key = uniqueKey("over");
    for (let i = 0; i < 3; i++) rateLimit(key, 3, 60_000);
    const res = rateLimit(key, 3, 60_000);
    expect(res.allowed).toBe(false);
    expect(res.retryAfterMs).toBeGreaterThan(0);
  });

  it("resets after the window expires", () => {
    const key = uniqueKey("window");
    // Fill to limit with a 1ms window so it expires immediately
    for (let i = 0; i < 2; i++) rateLimit(key, 2, 1);
    // Wait for the window to expire
    return new Promise<void>((resolve) => setTimeout(() => {
      expect(rateLimit(key, 2, 1).allowed).toBe(true);
      resolve();
    }, 5));
  });

  it("per-key isolation — different keys don't share counts", () => {
    const k1 = uniqueKey("iso-a");
    const k2 = uniqueKey("iso-b");
    for (let i = 0; i < 5; i++) rateLimit(k1, 5, 60_000);
    // k1 is at limit, k2 should still be allowed
    expect(rateLimit(k1, 5, 60_000).allowed).toBe(false);
    expect(rateLimit(k2, 5, 60_000).allowed).toBe(true);
  });

  it("the first request in a fresh window is always allowed", () => {
    const key = uniqueKey("fresh");
    expect(rateLimit(key, 1, 60_000).allowed).toBe(true);
  });

  it("second request at limit=1 is blocked", () => {
    const key = uniqueKey("limit1");
    rateLimit(key, 1, 60_000);
    expect(rateLimit(key, 1, 60_000).allowed).toBe(false);
  });
});

describe("clientKey", () => {
  it("returns the first X-Forwarded-For IP", () => {
    const req = new Request("http://localhost", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    expect(clientKey(req)).toBe("1.2.3.4");
  });

  it("returns 'unknown' when header is absent", () => {
    const req = new Request("http://localhost");
    expect(clientKey(req)).toBe("unknown");
  });

  it("trims whitespace around the IP", () => {
    const req = new Request("http://localhost", {
      headers: { "x-forwarded-for": "  9.9.9.9  " },
    });
    expect(clientKey(req)).toBe("9.9.9.9");
  });
});
