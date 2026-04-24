import { describe, it, expect, vi, beforeEach } from "vitest";
import { getLatestVersion } from "../../../src/lib/self-update/version-detector.js";

global.fetch = vi.fn() as unknown as typeof fetch;
const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;

function mockTokenThenTags(tags: string[]) {
  fetchMock
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: "anon-token" }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ name: "cowcow02/fleetlens-team-server", tags }),
    });
}

beforeEach(() => fetchMock.mockReset());

describe("getLatestVersion", () => {
  it("returns the highest semver tag from GHCR tags list", async () => {
    mockTokenThenTags(["0.4.1", "0.4.2", "0.5.0", "latest", "abc1234"]);
    const result = await getLatestVersion();
    expect(result).toBe("0.5.0");
  });

  it("filters out non-semver tags (latest, shas, etc.)", async () => {
    mockTokenThenTags(["latest", "main", "abc1234", "dev-123"]);
    const result = await getLatestVersion();
    expect(result).toBeNull();
  });

  it("orders by semver, not lexically", async () => {
    mockTokenThenTags(["0.9.0", "0.10.0"]);
    const result = await getLatestVersion();
    expect(result).toBe("0.10.0");
  });

  it("returns null when tags array is empty", async () => {
    mockTokenThenTags([]);
    expect(await getLatestVersion()).toBeNull();
  });

  it("throws on non-OK HTTP response from the tags endpoint", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ token: "anon-token" }) })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    await expect(getLatestVersion()).rejects.toThrow(/500/);
  });

  it("throws when the token endpoint returns non-OK", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) });
    await expect(getLatestVersion()).rejects.toThrow(/token endpoint returned 403/);
  });

  it("uses the anonymous token as a Bearer header on the tags request", async () => {
    mockTokenThenTags(["0.5.0"]);
    await getLatestVersion();
    const [, tagsCallOpts] = fetchMock.mock.calls[1];
    expect((tagsCallOpts as RequestInit).headers).toEqual(
      expect.objectContaining({ Authorization: "Bearer anon-token" }),
    );
  });
});
