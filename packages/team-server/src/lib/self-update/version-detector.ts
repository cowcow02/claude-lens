import semver from "semver";

const GHCR_REPO = "cowcow02/fleetlens-team-server";
const GHCR_TAGS_URL = `https://ghcr.io/v2/${GHCR_REPO}/tags/list`;
const GHCR_TOKEN_URL = `https://ghcr.io/token?scope=repository:${GHCR_REPO}:pull`;

// GHCR requires a Bearer token even on public images' registry API. Fetch an
// anonymous token first, then use it for the tags-list call.
async function getAnonToken(): Promise<string> {
  const res = await fetch(GHCR_TOKEN_URL, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`GHCR token endpoint returned ${res.status}`);
  const data = (await res.json()) as { token?: string };
  if (!data.token) throw new Error("GHCR token endpoint returned no token");
  return data.token;
}

export async function getLatestVersion(): Promise<string | null> {
  const token = await getAnonToken();
  const res = await fetch(GHCR_TAGS_URL, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`GHCR tags list returned ${res.status}`);
  const data = (await res.json()) as { tags?: string[] };
  const tags = data.tags ?? [];
  const semverTags = tags.filter((t) => semver.valid(t) !== null);
  if (semverTags.length === 0) return null;
  return semverTags.sort(semver.rcompare)[0];
}
