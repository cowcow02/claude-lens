import type { PlatformAdapter } from "./platform.js";

const IMAGE_REPO = "ghcr.io/cowcow02/fleetlens-team-server";
const RAILWAY_GQL = "https://backboard.railway.app/graphql/v2";

export class RailwayAdapter implements PlatformAdapter {
  readonly name = "railway" as const;
  private readonly token: string;
  private readonly projectId: string;
  private readonly serviceId: string;
  private readonly environmentId: string;

  constructor() {
    const { RAILWAY_TOKEN, RAILWAY_PROJECT_ID, RAILWAY_SERVICE_ID, RAILWAY_ENVIRONMENT_ID } =
      process.env;
    if (!RAILWAY_TOKEN) throw new Error("RailwayAdapter requires RAILWAY_TOKEN");
    if (!RAILWAY_PROJECT_ID || !RAILWAY_SERVICE_ID || !RAILWAY_ENVIRONMENT_ID) {
      throw new Error(
        "RailwayAdapter requires RAILWAY_PROJECT_ID, RAILWAY_SERVICE_ID, RAILWAY_ENVIRONMENT_ID",
      );
    }
    this.token = RAILWAY_TOKEN;
    this.projectId = RAILWAY_PROJECT_ID;
    this.serviceId = RAILWAY_SERVICE_ID;
    this.environmentId = RAILWAY_ENVIRONMENT_ID;
  }

  private async gql<T = unknown>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await fetch(RAILWAY_GQL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`Railway GraphQL ${res.status}`);
    const data = (await res.json()) as { data: T; errors?: unknown };
    if (data.errors) throw new Error(`Railway GraphQL error: ${JSON.stringify(data.errors)}`);
    return data.data;
  }

  async getCurrentImage(): Promise<{ image: string; tag: string | null }> {
    const data = await this.gql<{ serviceInstance: { source?: { image?: string } } }>(
      `query($projectId: String!, $serviceId: String!, $environmentId: String!) {
        serviceInstance(projectId: $projectId, serviceId: $serviceId, environmentId: $environmentId) {
          source { image }
        }
      }`,
      {
        projectId: this.projectId,
        serviceId: this.serviceId,
        environmentId: this.environmentId,
      },
    );
    const image = data.serviceInstance?.source?.image ?? "";
    const tag = image.includes(":") ? image.split(":").pop() ?? null : null;
    return { image, tag };
  }

  async redeploy(imageTag: string): Promise<{ revisionId: string }> {
    // NOTE: Railway's public GraphQL schema evolves. Mutation names used here
    // (`serviceInstanceUpdate` to set source image, `serviceInstanceDeploy` to trigger
    // redeploy) were verified at implementation time against https://docs.railway.com/reference/public-api.
    // If Railway renames these, update them here + the matching tests.
    await this.gql(
      `mutation($projectId: String!, $serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) {
        serviceInstanceUpdate(projectId: $projectId, serviceId: $serviceId, environmentId: $environmentId, input: $input) { id }
      }`,
      {
        projectId: this.projectId,
        serviceId: this.serviceId,
        environmentId: this.environmentId,
        input: { source: { image: `${IMAGE_REPO}:${imageTag}` } },
      },
    );

    const deployed = await this.gql<{ serviceInstanceDeploy: { id: string } }>(
      `mutation($projectId: String!, $serviceId: String!, $environmentId: String!) {
        serviceInstanceDeploy(projectId: $projectId, serviceId: $serviceId, environmentId: $environmentId) { id }
      }`,
      {
        projectId: this.projectId,
        serviceId: this.serviceId,
        environmentId: this.environmentId,
      },
    );
    return { revisionId: deployed.serviceInstanceDeploy.id };
  }
}
