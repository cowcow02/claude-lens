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
