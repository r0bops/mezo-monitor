CREATE TABLE "chain_endpoints" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"label" text NOT NULL,
	"rpc_url" text NOT NULL,
	"ws_url" text,
	"priority" integer DEFAULT 100 NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"healthy" boolean DEFAULT false NOT NULL,
	"last_height" integer,
	"latency_ms" integer,
	"last_ok_at" timestamp with time zone,
	"last_error" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chain_endpoints" ADD CONSTRAINT "chain_endpoints_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "chain_endpoints_chain_url_idx" ON "chain_endpoints" USING btree ("chain_id","rpc_url");--> statement-breakpoint
CREATE UNIQUE INDEX "chain_endpoints_one_active_idx" ON "chain_endpoints" USING btree ("chain_id") WHERE "chain_endpoints"."is_active";--> statement-breakpoint
CREATE INDEX "chain_endpoints_chain_idx" ON "chain_endpoints" USING btree ("chain_id");