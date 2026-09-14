CREATE TABLE "discovered_endpoints" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"url" text NOT NULL,
	"moniker" text,
	"network" text NOT NULL,
	"healthy" boolean DEFAULT true NOT NULL,
	"catching_up" boolean DEFAULT false NOT NULL,
	"earliest_height" integer,
	"latest_height" integer,
	"latency_ms" integer,
	"times_seen" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "discovered_endpoints" ADD CONSTRAINT "discovered_endpoints_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "discovered_endpoints_url_idx" ON "discovered_endpoints" USING btree ("chain_id","url");--> statement-breakpoint
CREATE INDEX "discovered_endpoints_chain_idx" ON "discovered_endpoints" USING btree ("chain_id");