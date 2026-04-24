import { describe, it, expect, vi, beforeEach } from "vitest";
import { getLatestVersion } from "../../../src/lib/self-update/version-detector.js";

global.fetch = vi.fn() as unknown as typeof fetch;
beforeEach(() => (global.fetch as unknown as ReturnType<typeof vi.fn>).mockReset());

describe("getLatestVersion", () => {
  it("returns the highest semver tag from GHCR tags list", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        name: "cowcow02/fleetlens-team-server",
        tags: ["0.4.1", "0.4.2", "0.5.0", "latest", "abc1234"],
      }),
    });
    const result = await getLatestVersion();
    expect(result).toBe("0.5.0");
  });

  it("filters out non-semver tags (latest, shas, etc.)", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ tags: ["latest", "main", "abc1234", "dev-123"] }),
    });
    const result = await getLatestVersion();
    expect(result).toBeNull();
  });

  it("orders by semver, not lexically", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ tags: ["0.9.0", "0.10.0"] }),
    });
    const result = await getLatestVersion();
    expect(result).toBe("0.10.0");
  });

  it("returns null when tags array is empty or missing", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ tags: [] }),
    });
    expect(await getLatestVersion()).toBeNull();

    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    expect(await getLatestVersion()).toBeNull();
  });

  it("throws on non-OK HTTP response", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    await expect(getLatestVersion()).rejects.toThrow(/500/);
  });
});
