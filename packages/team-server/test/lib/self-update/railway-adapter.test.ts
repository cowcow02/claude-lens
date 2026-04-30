import { describe, it, expect, vi, beforeEach } from "vitest";
import { RailwayAdapter } from "../../../src/lib/self-update/railway.js";

global.fetch = vi.fn() as unknown as typeof fetch;

beforeEach(() => {
  process.env.RAILWAY_TOKEN = "test-token";
  process.env.RAILWAY_PROJECT_ID = "proj-123";
  process.env.RAILWAY_SERVICE_ID = "svc-456";
  process.env.RAILWAY_ENVIRONMENT_ID = "env-789";
  (global.fetch as unknown as { mockReset: () => void }).mockReset();
});

describe("RailwayAdapter", () => {
  it("getCurrentImage queries the current service instance", async () => {
    (global.fetch as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          serviceInstance: { source: { image: "ghcr.io/cowcow02/fleetlens-team-server:0.4.2" } },
        },
      }),
    });
    const adapter = new RailwayAdapter();
    const result = await adapter.getCurrentImage();
    expect(result.tag).toBe("0.4.2");
    expect(result.image).toBe("ghcr.io/cowcow02/fleetlens-team-server:0.4.2");
  });

  it("redeploy updates source image + triggers redeploy via two GraphQL mutations", async () => {
    const fetchMock = global.fetch as unknown as {
      mockResolvedValueOnce: (v: unknown) => void;
      mock: { calls: [string, { body: string }][] };
    };
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { serviceInstanceUpdate: { id: "svc-456" } } }),
    });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { serviceInstanceDeploy: { id: "deploy-xyz" } } }),
    });

    const adapter = new RailwayAdapter();
    const result = await adapter.redeploy("0.5.0");

    expect(global.fetch).toHaveBeenCalledTimes(2);
    const firstCallBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(firstCallBody.variables.input.source.image).toBe(
      "ghcr.io/cowcow02/fleetlens-team-server:0.5.0",
    );
    const secondCallBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(secondCallBody.variables.projectId).toBe("proj-123");
    expect(secondCallBody.variables.serviceId).toBe("svc-456");
    expect(secondCallBody.variables.environmentId).toBe("env-789");
    expect(result.revisionId).toBe("deploy-xyz");
  });

  it("throws a clear error when RAILWAY_TOKEN is missing", () => {
    delete process.env.RAILWAY_TOKEN;
    expect(() => new RailwayAdapter()).toThrow(/RAILWAY_TOKEN/);
  });

  it("throws a clear error when RAILWAY_PROJECT_ID / SERVICE_ID / ENVIRONMENT_ID missing", () => {
    delete process.env.RAILWAY_PROJECT_ID;
    expect(() => new RailwayAdapter()).toThrow(/RAILWAY_PROJECT_ID/);
  });
});
