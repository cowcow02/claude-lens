import { describe, it, expect, vi, afterEach } from "vitest";

// scheduler.ts uses setInterval and getPool(); we test it by mocking the module
// to avoid actual database calls and actual timers.

describe("startScheduler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // Reset the module so `started` is reset between tests
    vi.resetModules();
  });

  it("starts without throwing", async () => {
    // Mock getPool to return a fake pool
    vi.doMock("../../src/db/pool.js", () => ({
      getPool: () => ({
        query: vi.fn().mockResolvedValue({ rowCount: 0 }),
      }),
    }));
    vi.useFakeTimers();
    const { startScheduler } = await import("../../src/lib/scheduler.js");
    expect(() => startScheduler()).not.toThrow();
    vi.useRealTimers();
  });

  it("is idempotent — calling twice does not create extra intervals", async () => {
    vi.doMock("../../src/db/pool.js", () => ({
      getPool: () => ({
        query: vi.fn().mockResolvedValue({ rowCount: 0 }),
      }),
    }));
    vi.useFakeTimers();
    const { startScheduler } = await import("../../src/lib/scheduler.js");
    const setIntervalSpy = vi.spyOn(global, "setInterval");
    startScheduler();
    startScheduler(); // second call is a no-op
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("interval callback logs when rows are pruned", async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rowCount: 5 });
    vi.doMock("../../src/db/pool.js", () => ({
      getPool: () => ({ query: mockQuery }),
    }));
    vi.useFakeTimers();
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { startScheduler } = await import("../../src/lib/scheduler.js");
    startScheduler();
    // Advance timer by 1 hour to trigger the interval callback
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM ingest_log")
    );
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("pruned 5"));
    vi.useRealTimers();
  });

  it("interval callback logs errors on DB failure", async () => {
    const mockQuery = vi.fn().mockRejectedValue(new Error("DB down"));
    vi.doMock("../../src/db/pool.js", () => ({
      getPool: () => ({ query: mockQuery }),
    }));
    vi.useFakeTimers();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { startScheduler } = await import("../../src/lib/scheduler.js");
    startScheduler();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("prune failed"));
    vi.useRealTimers();
  });
});
