import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  date,
  integer,
  bigint,
  bigserial,
  jsonb,
  index,
  uniqueIndex,
  check,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const userAccounts = pgTable("user_accounts", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name"),
  isStaff: boolean("is_staff").notNull().default(false),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  retentionDays: integer("retention_days").notNull().default(365),
  resendApiKeyEnc: text("resend_api_key_enc"),
  customDomain: text("custom_domain"),
  settings: jsonb("settings").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userAccountId: uuid("user_account_id")
      .notNull()
      .references(() => userAccounts.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    bearerTokenHash: text("bearer_token_hash"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => ({
    roleCheck: check("memberships_role_check", sql`${t.role} IN ('admin','member')`),
    uniqUserTeam: uniqueIndex("memberships_user_account_id_team_id_key").on(t.userAccountId, t.teamId),
    teamActive: index("idx_memberships_team_active").on(t.teamId).where(sql`${t.revokedAt} IS NULL`),
    bearer: index("idx_memberships_bearer").on(t.bearerTokenHash).where(sql`${t.bearerTokenHash} IS NOT NULL`),
  }),
);

export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").notNull().references(() => userAccounts.id),
    email: text("email"),
    tokenHash: text("token_hash").notNull().unique(),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    roleCheck: check("invites_role_check", sql`${t.role} IN ('admin','member')`),
  }),
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userAccountId: uuid("user_account_id")
      .notNull()
      .references(() => userAccounts.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => ({
    userIdx: index("idx_sessions_user").on(t.userAccountId),
  }),
);

export const dailyRollups = pgTable(
  "daily_rollups",
  {
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id").notNull().references(() => memberships.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    agentTimeMs: bigint("agent_time_ms", { mode: "number" }).notNull().default(0),
    sessions: integer("sessions").notNull().default(0),
    toolCalls: integer("tool_calls").notNull().default(0),
    turns: integer("turns").notNull().default(0),
    tokensInput: bigint("tokens_input", { mode: "number" }).notNull().default(0),
    tokensOutput: bigint("tokens_output", { mode: "number" }).notNull().default(0),
    tokensCacheRead: bigint("tokens_cache_read", { mode: "number" }).notNull().default(0),
    tokensCacheWrite: bigint("tokens_cache_write", { mode: "number" }).notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.teamId, t.membershipId, t.day] }),
    teamDay: index("idx_daily_rollups_team_day").on(t.teamId, sql`${t.day} DESC`),
  }),
);

export const events = pgTable(
  "events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    teamId: uuid("team_id").references(() => teams.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => userAccounts.id),
    action: text("action").notNull(),
    payload: jsonb("payload").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    teamCreated: index("idx_events_team_created").on(t.teamId, sql`${t.createdAt} DESC`),
  }),
);

export const ingestLog = pgTable(
  "ingest_log",
  {
    ingestId: text("ingest_id").primaryKey(),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id").notNull().references(() => memberships.id, { onDelete: "cascade" }),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    received: index("idx_ingest_log_received").on(t.receivedAt),
  }),
);

export const serverConfig = pgTable("server_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
