import { describe, it, expect, vi, afterEach } from "vitest";

describe("startScheduler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    delete process.env.FLEETLENS_EXTERNAL_SCHEDULER;
  });

  it("starts without throwing", async () => {
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
    startScheduler();
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

  it("skips setInterval when FLEETLENS_EXTERNAL_SCHEDULER=1", async () => {
    process.env.FLEETLENS_EXTERNAL_SCHEDULER = "1";
    vi.doMock("../../src/db/pool.js", () => ({
      getPool: () => ({ query: vi.fn() }),
    }));
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(global, "setInterval");
    const { startScheduler } = await import("../../src/lib/scheduler.js");
    startScheduler();
    expect(setIntervalSpy).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe("pruneIngestLog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("returns the row count of deleted rows", async () => {
    vi.doMock("../../src/db/pool.js", () => ({
      getPool: () => ({
        query: vi.fn().mockResolvedValue({ rowCount: 7 }),
      }),
    }));
    const { pruneIngestLog } = await import("../../src/lib/scheduler.js");
    await expect(pruneIngestLog()).resolves.toBe(7);
  });

  it("returns 0 when rowCount is null", async () => {
    vi.doMock("../../src/db/pool.js", () => ({
      getPool: () => ({
        query: vi.fn().mockResolvedValue({ rowCount: null }),
      }),
    }));
    const { pruneIngestLog } = await import("../../src/lib/scheduler.js");
    await expect(pruneIngestLog()).resolves.toBe(0);
  });
});
