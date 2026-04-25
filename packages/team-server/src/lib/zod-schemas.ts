import { z } from "zod";

const UsageWindowSchema = z.object({
  utilization: z.number().nullable(),
  resetsAt: z.string().datetime().nullable(),
}).passthrough();

const ExtraUsageSchema = z.object({
  isEnabled: z.boolean(),
  monthlyLimitUsd: z.number().nullable(),
  usedCreditsUsd: z.number().nullable(),
  utilization: z.number().nullable(),
}).passthrough();

export const UsageSnapshotSchema = z.object({
  capturedAt: z.string().datetime(),
  fiveHour: UsageWindowSchema,
  sevenDay: UsageWindowSchema,
  sevenDayOpus: UsageWindowSchema.nullable(),
  sevenDaySonnet: UsageWindowSchema.nullable(),
  sevenDayOauthApps: UsageWindowSchema.nullable(),
  sevenDayCowork: UsageWindowSchema.nullable(),
  extraUsage: ExtraUsageSchema.nullable(),
}).passthrough();

export type UsageSnapshot = z.infer<typeof UsageSnapshotSchema>;

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
