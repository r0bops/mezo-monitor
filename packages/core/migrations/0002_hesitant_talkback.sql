ALTER TABLE "alert_events" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "alert_events" ADD COLUMN "resolved_delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "alert_events" ADD COLUMN "delivery_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "alert_events" ADD COLUMN "delivery_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "alert_events" ADD COLUMN "delivery_error" text;--> statement-breakpoint
ALTER TABLE "alert_rules" ADD COLUMN "webhook_url" text;