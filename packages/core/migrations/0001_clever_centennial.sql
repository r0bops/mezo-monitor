CREATE TABLE "alert_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"rule_id" integer,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"subject" text,
	"height" integer,
	"fired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "alert_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"name" text NOT NULL,
	"metric" text NOT NULL,
	"comparator" text NOT NULL,
	"threshold" double precision NOT NULL,
	"severity" text NOT NULL,
	"channel" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_rule_id_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."alert_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alert_events_chain_fired_idx" ON "alert_events" USING btree ("chain_id","fired_at");--> statement-breakpoint
CREATE INDEX "alert_events_rule_open_idx" ON "alert_events" USING btree ("rule_id","subject","resolved_at");--> statement-breakpoint
CREATE INDEX "alert_rules_chain_idx" ON "alert_rules" USING btree ("chain_id");--> statement-breakpoint
CREATE UNIQUE INDEX "alert_rules_chain_name_idx" ON "alert_rules" USING btree ("chain_id","name");