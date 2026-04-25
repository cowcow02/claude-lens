-- description: Add plan_utilization snapshots, plan_tier on memberships, weekly mat view
CREATE TABLE "plan_utilization" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"five_hour_utilization" real,
	"five_hour_resets_at" timestamp with time zone,
	"seven_day_utilization" real,
	"seven_day_resets_at" timestamp with time zone,
	"seven_day_opus_utilization" real,
	"seven_day_sonnet_utilization" real,
	"seven_day_oauth_apps_utilization" real,
	"seven_day_cowork_utilization" real,
	"extra_usage_enabled" boolean DEFAULT false NOT NULL,
	"extra_usage_monthly_limit_usd" real,
	"extra_usage_used_credits_usd" real,
	"extra_usage_utilization" real
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "plan_tier" text DEFAULT 'pro-max' NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_utilization" ADD CONSTRAINT "plan_utilization_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_utilization" ADD CONSTRAINT "plan_utilization_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plan_utilization_snapshot_key" ON "plan_utilization" USING btree ("team_id","membership_id","captured_at");--> statement-breakpoint
CREATE INDEX "idx_plan_utilization_team_captured" ON "plan_utilization" USING btree ("team_id","captured_at" DESC);--> statement-breakpoint
CREATE INDEX "idx_plan_utilization_team_member_captured" ON "plan_utilization" USING btree ("team_id","membership_id","captured_at" DESC);--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_plan_tier_check" CHECK ("memberships"."plan_tier" IN ('pro','pro-max','pro-max-20x','custom'));--> statement-breakpoint
-- Per-membership rolling-7-day-window utilization rollups.
-- Refreshed hourly by the scheduler. window_start_day is the day each
-- member's 7-day window opened (date_trunc('day', resets_at - 7d)).
CREATE MATERIALIZED VIEW "membership_weekly_utilization" AS
SELECT
  team_id,
  membership_id,
  date_trunc('day', seven_day_resets_at - interval '7 days') AS window_start_day,
  MAX(seven_day_resets_at)            AS window_end,
  MAX(seven_day_utilization)          AS peak_seven_day_pct,
  AVG(seven_day_utilization)          AS avg_seven_day_pct,
  MAX(five_hour_utilization)          AS peak_five_hour_pct,
  MAX(seven_day_opus_utilization)     AS peak_opus_pct,
  MAX(seven_day_sonnet_utilization)   AS peak_sonnet_pct,
  MAX(extra_usage_used_credits_usd)   AS peak_extra_credits_usd,
  MAX(extra_usage_monthly_limit_usd)  AS extra_monthly_limit_usd,
  COUNT(*)                            AS snapshot_count,
  COUNT(DISTINCT date_trunc('day', captured_at)) AS distinct_days_observed,
  MAX(captured_at)                    AS last_captured_at
FROM plan_utilization
WHERE seven_day_resets_at IS NOT NULL
GROUP BY team_id, membership_id, date_trunc('day', seven_day_resets_at - interval '7 days');--> statement-breakpoint
-- Unique index makes REFRESH MATERIALIZED VIEW CONCURRENTLY usable.
CREATE UNIQUE INDEX "membership_weekly_utilization_pk"
  ON "membership_weekly_utilization" (team_id, membership_id, window_start_day);