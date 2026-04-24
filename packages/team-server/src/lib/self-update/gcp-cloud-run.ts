import { v2 as runV2 } from "@google-cloud/run";
import type { PlatformAdapter } from "./platform";

const IMAGE_REPO = "ghcr.io/cowcow02/fleetlens-team-server";

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

  async getCurrentImage(): Promise<{ image: string; tag: string | null }> {
    const client = new runV2.ServicesClient();
    const [service] = await client.getService({ name: this.getServiceName() });
    const image = service.template?.containers?.[0]?.image ?? "";
    const tag = image.includes(":") ? image.split(":").pop() ?? null : null;
    return { image, tag };
  }

  async redeploy(imageTag: string): Promise<{ revisionId: string }> {
    const client = new runV2.ServicesClient();
    const [service] = await client.getService({ name: this.getServiceName() });
    // Read-modify-write. Mutate only the container image; preserve everything else.
    if (!service.template?.containers?.[0]) {
      throw new Error("Unexpected Cloud Run service spec: missing template.containers[0]");
    }
    service.template.containers[0].image = `${IMAGE_REPO}:${imageTag}`;
    const [op] = await client.updateService({ service });
    // Cloud Run's long-running op has `.metadata.revision` on the first response.
    const revisionId = (op as { metadata?: { revision?: string } }).metadata?.revision ?? "unknown";
    return { revisionId };
  }
}
