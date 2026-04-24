import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getChangelog,
  getMigrationsManifest,
} from "../../../src/lib/self-update/changelog-fetcher.js";

global.fetch = vi.fn() as unknown as typeof fetch;
beforeEach(() => (global.fetch as unknown as ReturnType<typeof vi.fn>).mockReset());

describe("getChangelog", () => {
  it("fetches the release body for a server-v<version> tag", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ body: "# v0.5.0\n- new feature\n" }),
    });
    const body = await getChangelog("0.5.0");
    expect(body).toBe("# v0.5.0\n- new feature\n");
    const call = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe(
      "https://api.github.com/repos/cowcow02/fleetlens/releases/tags/server-v0.5.0",
    );
    expect(call[1].headers.Accept).toBe("application/vnd.github+json");
  });

  it("returns empty string when release has no body", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    expect(await getChangelog("0.5.0")).toBe("");
  });

  it("throws on non-OK response", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    });
    await expect(getChangelog("9.9.9")).rejects.toThrow(/404/);
  });
});

describe("getMigrationsManifest", () => {
  it("fetches the manifest asset and returns the parsed JSON", async () => {
    const manifest = {
      version: "0.5.0",
      migrations: [
        {
          filename: "0001_update_check_cache.sql",
          description: "Add update_check_cache + promote initial team admin to staff",
          sql: "CREATE TABLE update_check_cache ...",
        },
      ],
    };
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => manifest,
    });
    const result = await getMigrationsManifest("0.5.0");
    expect(result).toEqual(manifest);
    const call = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe(
      "https://github.com/cowcow02/fleetlens/releases/download/server-v0.5.0/migrations-manifest.json",
    );
  });

  it("throws on non-OK response", async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    });
    await expect(getMigrationsManifest("9.9.9")).rejects.toThrow(/404/);
  });
});
