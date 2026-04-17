import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TeamConfig } from "../../src/team/config.js";

const SAMPLE: TeamConfig = {
  serverUrl: "https://team.example.com",
  memberId: "mem_abc",
  bearerToken: "tok_secret",
  teamSlug: "acme",
  pairedAt: "2026-01-01T00:00:00.000Z",
};

vi.mock("../../src/team/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/team/config.js")>();
  return {
    ...actual,
    readTeamConfig: vi.fn(),
  };
});

describe("teamStatus", () => {
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

  it("prints 'Not paired' when no config exists", async () => {
    const { readTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue(null);

    const { teamStatus } = await import("../../src/team/status.js");
    await teamStatus();

    expect(consoleLogSpy).toHaveBeenCalledWith("Not paired with any team.");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("prints config fields when paired", async () => {
    const { readTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue(SAMPLE);
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 400,
    } as Response);

    const { teamStatus } = await import("../../src/team/status.js");
    await teamStatus();

    const printed = consoleLogSpy.mock.calls.map((c) => c[0] as string);
    expect(printed.some((l) => l.includes("acme"))).toBe(true);
    expect(printed.some((l) => l.includes("https://team.example.com"))).toBe(true);
    expect(printed.some((l) => l.includes("mem_abc"))).toBe(true);
  });

  it("prints 'Connected' on 400 response (expected validation error)", async () => {
    const { readTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue(SAMPLE);
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 400,
    } as Response);

    const { teamStatus } = await import("../../src/team/status.js");
    await teamStatus();

    expect(consoleLogSpy).toHaveBeenCalledWith("Status:  Connected");
  });

  it("prints 'Connected' on 200 response", async () => {
    const { readTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue(SAMPLE);
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
    } as Response);

    const { teamStatus } = await import("../../src/team/status.js");
    await teamStatus();

    expect(consoleLogSpy).toHaveBeenCalledWith("Status:  Connected");
  });

  it("prints token-revoked warning on 401 response", async () => {
    const { readTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue(SAMPLE);
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
    } as Response);

    const { teamStatus } = await import("../../src/team/status.js");
    await teamStatus();

    const printed = consoleLogSpy.mock.calls.map((c) => c[0] as string);
    expect(printed.some((l) => l.includes("Token revoked"))).toBe(true);
  });

  it("prints 'Cannot reach server' when fetch throws", async () => {
    const { readTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue(SAMPLE);
    vi.mocked(fetch).mockRejectedValueOnce(new Error("Network timeout"));

    const { teamStatus } = await import("../../src/team/status.js");
    await teamStatus();

    expect(consoleLogSpy).toHaveBeenCalledWith("Status:  ! Cannot reach server");
  });

  it("calls the metrics endpoint with correct headers", async () => {
    const { readTeamConfig } = await import("../../src/team/config.js");
    vi.mocked(readTeamConfig).mockReturnValue(SAMPLE);
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 400,
    } as Response);

    const { teamStatus } = await import("../../src/team/status.js");
    await teamStatus();

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("https://team.example.com/api/ingest/metrics");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer tok_secret",
    });
  });
});
