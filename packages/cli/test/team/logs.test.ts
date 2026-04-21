import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock node:fs at the module level so readFileSync is interceptable.
// teamLogs imports readFileSync from "node:fs" directly, so we need to
// intercept that import.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, readFileSync: vi.fn() };
});

describe("teamLogs", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  it("prints team-related lines from the daemon log", async () => {
    const { readFileSync } = await import("node:fs");
    const lines = [
      "2026-04-17T10:00:00Z [info] team push ok: 1 day pushed",
      "2026-04-17T10:05:00Z [info] usage snapshot saved",
      "2026-04-17T10:10:00Z [warn] team push failed on 2026-04-16 (503); queueing",
    ];
    vi.mocked(readFileSync).mockReturnValue(lines.join("\n") as unknown as Buffer);

    const { teamLogs } = await import("../../src/team/logs.js");
    await teamLogs();

    const printed = consoleLogSpy.mock.calls.map((c) => c[0] as string);
    expect(printed).toContain(lines[0]);
    expect(printed).toContain(lines[2]);
    // non-team line should not appear
    expect(printed).not.toContain(lines[1]);
  });

  it("prints fallback message when no team lines exist", async () => {
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockReturnValue(
      "no relevant lines here\nanother line\n" as unknown as Buffer,
    );

    const { teamLogs } = await import("../../src/team/logs.js");
    await teamLogs();

    expect(consoleLogSpy).toHaveBeenCalledWith("No team-related log entries found.");
  });

  it("prints fallback when daemon.log file is missing", async () => {
    const { readFileSync } = await import("node:fs");
    vi.mocked(readFileSync).mockImplementation(() => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });

    const { teamLogs } = await import("../../src/team/logs.js");
    await teamLogs();

    expect(consoleLogSpy).toHaveBeenCalledWith("No daemon log found. Is the daemon running?");
  });

  it("prints at most 20 lines when there are more", async () => {
    const { readFileSync } = await import("node:fs");
    const teamLines = Array.from(
      { length: 30 },
      (_, i) => `2026-04-17T10:${String(i).padStart(2, "0")}:00Z [info] team push ok: ${i}`,
    );
    vi.mocked(readFileSync).mockReturnValue(teamLines.join("\n") as unknown as Buffer);

    const { teamLogs } = await import("../../src/team/logs.js");
    await teamLogs();

    expect(consoleLogSpy).toHaveBeenCalledTimes(20);
  });
});
