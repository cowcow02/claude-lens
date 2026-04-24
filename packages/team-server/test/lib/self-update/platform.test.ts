import { describe, it, expect, beforeEach } from "vitest";
import { getPlatformAdapter } from "../../../src/lib/self-update/platform.js";

describe("getPlatformAdapter", () => {
  beforeEach(() => {
    delete process.env.K_SERVICE;
    delete process.env.RAILWAY_TOKEN;
    delete process.env.RAILWAY_PROJECT_ID;
    delete process.env.RAILWAY_SERVICE_ID;
    delete process.env.RAILWAY_ENVIRONMENT_ID;
  });

  it("returns GcpCloudRunAdapter when K_SERVICE is set", () => {
    process.env.K_SERVICE = "svc";
    process.env.GCP_PROJECT_ID = "p";
    process.env.GCP_REGION = "r";
    expect(getPlatformAdapter()?.name).toBe("gcp-cloud-run");
  });

  it("returns RailwayAdapter when RAILWAY_TOKEN is set (and K_SERVICE isn't)", () => {
    process.env.RAILWAY_TOKEN = "t";
    process.env.RAILWAY_PROJECT_ID = "p";
    process.env.RAILWAY_SERVICE_ID = "s";
    process.env.RAILWAY_ENVIRONMENT_ID = "e";
    expect(getPlatformAdapter()?.name).toBe("railway");
  });

  it("returns null when neither env var is present", () => {
    expect(getPlatformAdapter()).toBeNull();
  });
});
