-- description: Per-cycle peak utilization computed locally by daemon (single source of truth shared with personal edition)
CREATE TABLE "membership_cycle_peaks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"window" text NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"peak_pct" real NOT NULL,
	"source" text NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "membership_cycle_peaks" ADD CONSTRAINT "membership_cycle_peaks_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_cycle_peaks" ADD CONSTRAINT "membership_cycle_peaks_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_cycle_peaks" ADD CONSTRAINT "membership_cycle_peaks_window_check" CHECK ("membership_cycle_peaks"."window" IN ('5h','7d'));--> statement-breakpoint
ALTER TABLE "membership_cycle_peaks" ADD CONSTRAINT "membership_cycle_peaks_source_check" CHECK ("membership_cycle_peaks"."source" IN ('real','predicted'));--> statement-breakpoint
CREATE UNIQUE INDEX "membership_cycle_peaks_pk" ON "membership_cycle_peaks" USING btree ("team_id","membership_id","window","ends_at");--> statement-breakpoint
CREATE INDEX "idx_membership_cycle_peaks_team_window" ON "membership_cycle_peaks" USING btree ("team_id","window","ends_at" DESC);
