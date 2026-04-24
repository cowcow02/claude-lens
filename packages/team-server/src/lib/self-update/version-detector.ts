import semver from "semver";

const GHCR_TAGS_URL = "https://ghcr.io/v2/cowcow02/fleetlens-team-server/tags/list";

export async function getLatestVersion(): Promise<string | null> {
  const res = await fetch(GHCR_TAGS_URL);
  if (!res.ok) throw new Error(`GHCR tags list returned ${res.status}`);
  const data = (await res.json()) as { tags?: string[] };
  const tags = data.tags ?? [];
  const semverTags = tags.filter((t) => semver.valid(t) !== null);
  if (semverTags.length === 0) return null;
  return semverTags.sort(semver.rcompare)[0];
}
