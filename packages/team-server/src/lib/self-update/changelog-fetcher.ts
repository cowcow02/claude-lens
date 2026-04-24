const GH_REPO = "cowcow02/fleetlens";

export async function getChangelog(version: string): Promise<string> {
  const res = await fetch(
    `https://api.github.com/repos/${GH_REPO}/releases/tags/server-v${version}`,
    { headers: { Accept: "application/vnd.github+json" } },
  );
  if (!res.ok) throw new Error(`GitHub Releases API returned ${res.status}`);
  const data = (await res.json()) as { body?: string };
  return data.body ?? "";
}

export interface MigrationInfo {
  filename: string;
  description: string;
  sql: string;
}

export async function getMigrationsManifest(
  version: string,
): Promise<{ version: string; migrations: MigrationInfo[] }> {
  const url = `https://github.com/${GH_REPO}/releases/download/server-v${version}/migrations-manifest.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Manifest fetch returned ${res.status}`);
  return res.json();
}
