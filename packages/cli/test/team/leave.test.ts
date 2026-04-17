import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeTeamConfig, type TeamConfig } from "../../src/team/config.js";

const SAMPLE: TeamConfig = {
  serverUrl: "https://team.example.com",
  memberId: "mem_abc",
  bearerToken: "tok_secret",
  teamSlug: "acme",
  pairedAt: "2026-01-01T00:00:00.000Z",
};

// teamLeave calls readTeamConfig() / clearTeamConfig() with no dir arg, which
// defaults to ~/.cclens. We redirect by mocking the config module.
vi.mock("../../src/team/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/team/config.js")>();
  return {
    ...actual,
    readTeamConfig: vi.fn(),
    clearTeamConfig: vi.fn(),
  };
});

describe("teamLeave", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it("logs 'Not paired' and returns when no config exists", async () => {
    const { readTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue(null);

    const { teamLeave } = await import("../../src/team/leave.js");
    await teamLeave();

    expect(consoleLogSpy).toHaveBeenCalledWith("Not paired with any team.");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("calls leave endpoint and clears config on success", async () => {
    const { readTeamConfig, clearTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue(SAMPLE);
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
    } as Response);

    const { teamLeave } = await import("../../src/team/leave.js");
    await teamLeave();

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("https://team.example.com/api/team/leave");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer tok_secret",
    });

    expect(clearTeamConfig).toHaveBeenCalledOnce();
    expect(consoleLogSpy).toHaveBeenCalledWith("Left team. Local data is unaffected.");
  });

  it("still clears config even if leave endpoint throws a network error", async () => {
    const { readTeamConfig, clearTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue(SAMPLE);
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Network error"));

    const { teamLeave } = await import("../../src/team/leave.js");
    await teamLeave();

    // Should not throw — errors are swallowed
    expect(clearTeamConfig).toHaveBeenCalledOnce();
    expect(consoleLogSpy).toHaveBeenCalledWith("Left team. Local data is unaffected.");
  });

  it("still clears config even if leave endpoint returns non-ok status", async () => {
    const { readTeamConfig, clearTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue(SAMPLE);
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
    } as Response);

    const { teamLeave } = await import("../../src/team/leave.js");
    await teamLeave();

    expect(clearTeamConfig).toHaveBeenCalledOnce();
    expect(consoleLogSpy).toHaveBeenCalledWith("Left team. Local data is unaffected.");
  });
});
