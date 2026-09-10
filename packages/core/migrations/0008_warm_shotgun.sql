CREATE TABLE "validator_location_ips" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"validator_address" text NOT NULL,
	"ip" text NOT NULL,
	"country_code" text,
	"country" text,
	"city" text,
	"isp" text,
	"times_seen" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "validator_locations" ADD COLUMN "source" text DEFAULT 'peer' NOT NULL;--> statement-breakpoint
ALTER TABLE "validator_location_ips" ADD CONSTRAINT "validator_location_ips_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "validator_location_ips_key_idx" ON "validator_location_ips" USING btree ("chain_id","validator_address","ip");--> statement-breakpoint
CREATE INDEX "validator_location_ips_chain_idx" ON "validator_location_ips" USING btree ("chain_id");