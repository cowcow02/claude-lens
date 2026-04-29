import { z } from "zod";

const UsageWindowSchema = z.object({
  utilization: z.number().nullable(),
  resetsAt: z.string().datetime({ offset: true }).nullable(),
}).passthrough();

const ExtraUsageSchema = z.object({
  isEnabled: z.boolean(),
  monthlyLimitUsd: z.number().nullable(),
  usedCreditsUsd: z.number().nullable(),
  utilization: z.number().nullable(),
}).passthrough();

export const UsageSnapshotSchema = z.object({
  capturedAt: z.string().datetime({ offset: true }),
  fiveHour: UsageWindowSchema,
  sevenDay: UsageWindowSchema,
  sevenDayOpus: UsageWindowSchema.nullable(),
  sevenDaySonnet: UsageWindowSchema.nullable(),
  sevenDayOauthApps: UsageWindowSchema.nullable(),
  sevenDayCowork: UsageWindowSchema.nullable(),
  extraUsage: ExtraUsageSchema.nullable(),
}).passthrough();

export type UsageSnapshot = z.infer<typeof UsageSnapshotSchema>;

// Mirrors `members.plan_tier` CHECK in 0002_plan_utilization.sql. Daemon
// either knows the tier (mapped from Anthropic's rate_limit_tier) or omits
// the field entirely. Server treats anything outside this enum as "skip
// upsert" so a future Anthropic tier code never silently downgrades us.
export const PlanTierKeySchema = z.enum(["pro", "pro-max", "pro-max-20x", "custom"]);

// Cap per-request to keep transactions bounded; the daemon batches.
export const UsageHistoryPayload = z.object({
  snapshots: z.array(UsageSnapshotSchema).min(1).max(1000),
  planTier: PlanTierKeySchema.optional(),
});

export const IngestPayload = z.object({
  ingestId: z.string(),
  observedAt: z.string().datetime(),
  dailyRollup: z.object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    agentTimeMs: z.number().int().nonnegative(),
    sessions: z.number().int().nonnegative(),
    toolCalls: z.number().int().nonnegative(),
    turns: z.number().int().nonnegative(),
    tokens: z.object({
      input: z.number().int().nonnegative(),
      output: z.number().int().nonnegative(),
      cacheRead: z.number().int().nonnegative(),
      cacheWrite: z.number().int().nonnegative(),
    }).passthrough(),
  }).passthrough(),
  usageSnapshot: UsageSnapshotSchema.optional(),
  planTier: PlanTierKeySchema.optional(),
}).passthrough();

export const ClaimPayload = z.object({
  bootstrapToken: z.string(),
  teamName: z.string().min(1).max(100),
  adminEmail: z.string().email().optional(),
  adminDisplayName: z.string().min(1).max(100).optional(),
});

export const InvitePayload = z.object({
  label: z.string().max(100).optional(),
  expiresInDays: z.number().int().min(1).max(30).default(7),
});

export const JoinPayload = z.object({
  inviteToken: z.string(),
  email: z.string().email().optional(),
  displayName: z.string().max(100).optional(),
});
