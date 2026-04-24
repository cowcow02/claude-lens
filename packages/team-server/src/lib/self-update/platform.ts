import { GcpCloudRunAdapter } from "./gcp-cloud-run.js";
import { RailwayAdapter } from "./railway.js";

export interface PlatformAdapter {
  readonly name: "gcp-cloud-run" | "railway";

  /**
   * Return the currently-running image reference. Read-only.
   * Used for audit + sanity checks before redeploy.
   */
  getCurrentImage(): Promise<{ image: string; tag: string | null }>;

  /**
   * Instruct the platform to redeploy this service with a new image tag.
   * Resolves when the platform has accepted the request (NOT when the new
   * revision is healthy — that's async).
   */
  redeploy(imageTag: string): Promise<{ revisionId: string }>;
}

export function getPlatformAdapter(): PlatformAdapter | null {
  if (process.env.K_SERVICE) return new GcpCloudRunAdapter();
  if (process.env.RAILWAY_TOKEN) return new RailwayAdapter();
  return null;
}
