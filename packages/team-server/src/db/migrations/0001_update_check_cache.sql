-- description: Add update_check_cache + promote initial team admin to staff
CREATE TABLE "update_check_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"current_version" text,
	"latest_version" text,
	"update_available" boolean DEFAULT false NOT NULL,
	"last_checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_update_attempt" jsonb
);
--> statement-breakpoint
-- Data migration: ensure at least one staff user exists on upgrade from v0.4.x.
-- Promotes the admin of the oldest team. No-op if any staff user already exists.
UPDATE user_accounts
SET is_staff = true
WHERE id IN (
  SELECT m.user_account_id
  FROM memberships m
  JOIN teams t ON t.id = m.team_id
  WHERE m.role = 'admin' AND m.revoked_at IS NULL
  ORDER BY t.created_at ASC, m.joined_at ASC
  LIMIT 1
)
AND NOT EXISTS (SELECT 1 FROM user_accounts WHERE is_staff = true);
