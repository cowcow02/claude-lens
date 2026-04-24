import { v2 as runV2 } from "@google-cloud/run";
import type { PlatformAdapter } from "./platform";

// Derive the image repo from the currently-running image rather than hardcoding
// ghcr.io/cowcow02/... — Cloud Run can't pull from GHCR directly, so real
// deployments mirror the image to a regional Artifact Registry repo. Using the
// current image's repo segment (everything before the final `:tag`) means the
// adapter stays correct on both Artifact Registry and any future registry the
// deployer chooses, without a configuration surface.

export class GcpCloudRunAdapter implements PlatformAdapter {
  readonly name = "gcp-cloud-run" as const;

  private getServiceName(): string {
    const project = process.env.GCP_PROJECT_ID;
    const region = process.env.GCP_REGION;
    const service = process.env.K_SERVICE;
    if (!project || !region || !service) {
      throw new Error(
        "GcpCloudRunAdapter requires GCP_PROJECT_ID, GCP_REGION, K_SERVICE env vars",
      );
    }
    return `projects/${project}/locations/${region}/services/${service}`;
  }

  private extractRepo(image: string): string {
    // Split off the final `:tag` segment, if present. Image refs can contain
    // colons in their registry port (e.g., `localhost:5000/foo:v1`) so we look
    // for the last colon that's followed by non-slash chars (= tag separator).
    const lastColon = image.lastIndexOf(":");
    if (lastColon === -1) return image;
    const afterColon = image.slice(lastColon + 1);
    if (afterColon.includes("/")) return image; // colon is part of a port, not a tag
    return image.slice(0, lastColon);
  }

  async getCurrentImage(): Promise<{ image: string; tag: string | null }> {
    const client = new runV2.ServicesClient();
    const [service] = await client.getService({ name: this.getServiceName() });
    const image = service.template?.containers?.[0]?.image ?? "";
    const repo = this.extractRepo(image);
    const tag = image !== repo ? image.slice(repo.length + 1) : null;
    return { image, tag };
  }

  async redeploy(imageTag: string): Promise<{ revisionId: string }> {
    const client = new runV2.ServicesClient();
    const [service] = await client.getService({ name: this.getServiceName() });
    if (!service.template?.containers?.[0]) {
      throw new Error("Unexpected Cloud Run service spec: missing template.containers[0]");
    }
    const currentImage = service.template.containers[0].image ?? "";
    const repo = this.extractRepo(currentImage);
    if (!repo) {
      throw new Error("Cannot determine image repo from current service spec");
    }
    // Read-modify-write. Mutate only the container image; preserve everything else.
    service.template.containers[0].image = `${repo}:${imageTag}`;
    const [op] = await client.updateService({ service });
    // Cloud Run's long-running op has `.metadata.revision` on the first response.
    const revisionId = (op as { metadata?: { revision?: string } }).metadata?.revision ?? "unknown";
    return { revisionId };
  }
}
