import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { readOAuthCredentials } from "./token.js";

// Anthropic's `/api/oauth/profile` returns the user's account + organization
// info, including a `rate_limit_tier` string we can map to our plan-tier
// catalog. The endpoint isn't part of the documented public API but is the
// same source Claude Code uses internally — same OAuth token + beta header
// as the usage endpoint.
const PROFILE_ENDPOINT = "https://api.anthropic.com/api/oauth/profile";
const BETA_HEADER = "oauth-2025-04-20";

// Tier doesn't change snapshot-to-snapshot. A 24h cache means a daemon push
// every 5 minutes makes one profile request per day, not per cycle.
const PROFILE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type PlanTierKey = "pro" | "pro-max" | "pro-max-20x" | "custom";

export type AnthropicProfile = {
  planTier: PlanTierKey;
  rateLimitTier: string | null;
  organizationType: string | null;
};

type ProfileCacheEntry = {
  fetchedAtMs: number;
  profile: AnthropicProfile;
};

// Maps Anthropic's `rate_limit_tier` strings to our catalog keys. Anything
// unknown falls back to `custom` so we never silently mislabel a paid tier.
function mapRateLimitTier(rateLimitTier: string | null): PlanTierKey {
  switch (rateLimitTier) {
    case "default_claude_pro":
      return "pro";
    case "default_claude_max":
    case "default_claude_max_5x":
      return "pro-max";
    case "default_claude_max_20x":
      return "pro-max-20x";
    default:
      return "custom";
  }
}

export async function fetchProfile(nowMs: number = Date.now()): Promise<AnthropicProfile | null> {
  const creds = readOAuthCredentials();
  if (!creds) return null;
  if (creds.expiresAt - 60_000 <= nowMs) return null;

  let res: Response;
  try {
    res = await fetch(PROFILE_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "anthropic-beta": BETA_HEADER,
      },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const body = (await res.json().catch(() => null)) as
    | {
        organization?: { rate_limit_tier?: string; organization_type?: string };
      }
    | null;
  if (!body) return null;

  const rateLimitTier = body.organization?.rate_limit_tier ?? null;
  return {
    planTier: mapRateLimitTier(rateLimitTier),
    rateLimitTier,
    organizationType: body.organization?.organization_type ?? null,
  };
}

export function readCachedProfile(cachePath: string): ProfileCacheEntry | null {
  if (!existsSync(cachePath)) return null;
  try {
    const raw = JSON.parse(readFileSync(cachePath, "utf8")) as ProfileCacheEntry;
    if (typeof raw.fetchedAtMs !== "number" || !raw.profile) return null;
    return raw;
  } catch {
    return null;
  }
}

export function writeCachedProfile(cachePath: string, profile: AnthropicProfile, nowMs: number = Date.now()): void {
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(
    cachePath,
    JSON.stringify({ fetchedAtMs: nowMs, profile }, null, 2),
    { mode: 0o600 },
  );
}

export async function getPlanTier(
  cachePath: string,
  nowMs: number = Date.now(),
  fetcher: (nowMs?: number) => Promise<AnthropicProfile | null> = fetchProfile,
): Promise<PlanTierKey | null> {
  const cached = readCachedProfile(cachePath);
  if (cached && nowMs - cached.fetchedAtMs < PROFILE_CACHE_TTL_MS) {
    return cached.profile.planTier;
  }
  const fresh = await fetcher(nowMs);
  if (!fresh) {
    // Stale cache is better than nothing — Anthropic API hiccup shouldn't
    // erase a previously-known tier.
    return cached?.profile.planTier ?? null;
  }
  writeCachedProfile(cachePath, fresh, nowMs);
  return fresh.planTier;
}

// Exposed so tests can pin behavior without re-implementing the mapping.
export const __testing = { mapRateLimitTier };
