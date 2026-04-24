import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetService = vi.fn();
const mockUpdateService = vi.fn();

vi.mock("@google-cloud/run", () => ({
  v2: {
    ServicesClient: vi.fn().mockImplementation(() => ({
      getService: mockGetService,
      updateService: mockUpdateService,
    })),
  },
}));

import { GcpCloudRunAdapter } from "../../../src/lib/self-update/gcp-cloud-run.js";

beforeEach(() => {
  process.env.K_SERVICE = "fleetlens-team-server";
  process.env.K_CONFIGURATION = "fleetlens-team-server";
  process.env.GCP_PROJECT_ID = "kipwise";
  // Cloud Run injects these at runtime; the installer in Chunk 7 sets GCP_PROJECT_ID + region.
  process.env.GCP_REGION = "asia-southeast1";
  mockGetService.mockReset();
  mockUpdateService.mockReset();
});

describe("GcpCloudRunAdapter", () => {
  it("getCurrentImage returns the current image + tag", async () => {
    mockGetService.mockResolvedValue([
      { template: { containers: [{ image: "ghcr.io/cowcow02/fleetlens-team-server:0.4.2" }] } },
    ]);
    const adapter = new GcpCloudRunAdapter();
    const result = await adapter.getCurrentImage();
    expect(result).toEqual({ image: "ghcr.io/cowcow02/fleetlens-team-server:0.4.2", tag: "0.4.2" });
  });

  it("redeploy reads the current service, patches image, writes it back", async () => {
    mockGetService.mockResolvedValue([
      {
        name: "projects/kipwise/locations/asia-southeast1/services/fleetlens-team-server",
        template: {
          containers: [{ image: "ghcr.io/cowcow02/fleetlens-team-server:0.4.2" }],
        },
        // other fields we must preserve
        serviceAccount: "1234-compute@developer.gserviceaccount.com",
      },
    ]);
    mockUpdateService.mockResolvedValue([
      { metadata: { revision: "fleetlens-team-server-00007-xyz" } },
    ]);

    const adapter = new GcpCloudRunAdapter();
    const result = await adapter.redeploy("0.5.0");

    expect(mockUpdateService).toHaveBeenCalledTimes(1);
    const [arg] = mockUpdateService.mock.calls[0];
    expect(arg.service.template.containers[0].image).toBe(
      "ghcr.io/cowcow02/fleetlens-team-server:0.5.0",
    );
    // Preserved fields survive the read-modify-write:
    expect(arg.service.serviceAccount).toBe("1234-compute@developer.gserviceaccount.com");
    expect(result.revisionId).toBe("fleetlens-team-server-00007-xyz");
  });

  it("throws at call time if required env vars are missing (constructor does not check)", async () => {
    delete process.env.GCP_PROJECT_ID;
    // Constructor must not throw even with env missing.
    const adapter = new GcpCloudRunAdapter();
    await expect(adapter.getCurrentImage()).rejects.toThrow(/GCP_PROJECT_ID/);

    process.env.GCP_PROJECT_ID = "kipwise";
    delete process.env.GCP_REGION;
    await expect(adapter.redeploy("0.5.0")).rejects.toThrow(/GCP_REGION/);

    process.env.GCP_REGION = "asia-southeast1";
    delete process.env.K_SERVICE;
    await expect(adapter.getCurrentImage()).rejects.toThrow(/K_SERVICE/);
  });
});
