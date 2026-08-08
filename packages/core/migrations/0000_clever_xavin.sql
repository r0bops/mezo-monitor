CREATE TABLE "block_signatures" (
	"chain_id" integer NOT NULL,
	"height" integer NOT NULL,
	"validator_address" text NOT NULL,
	"signed" boolean NOT NULL,
	"time" timestamp with time zone NOT NULL,
	CONSTRAINT "block_signatures_chain_id_height_validator_address_pk" PRIMARY KEY("chain_id","height","validator_address")
);
--> statement-breakpoint
CREATE TABLE "blocks" (
	"chain_id" integer NOT NULL,
	"height" integer NOT NULL,
	"hash" text,
	"time" timestamp with time zone NOT NULL,
	"proposer_address" text,
	"validator_count" integer,
	"signature_count" integer,
	"tx_count" integer,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocks_chain_id_height_pk" PRIMARY KEY("chain_id","height")
);
--> statement-breakpoint
CREATE TABLE "chains" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"chain_id" text NOT NULL,
	"family" text NOT NULL,
	"rpc_url" text NOT NULL,
	"ws_url" text,
	"blockscout_url" text,
	"capabilities" jsonb NOT NULL,
	"latest_indexed_height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chains_slug_unique" UNIQUE("slug"),
	CONSTRAINT "chains_chain_id_unique" UNIQUE("chain_id")
);
--> statement-breakpoint
CREATE TABLE "validator_set_changes" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"height" integer NOT NULL,
	"validator_address" text NOT NULL,
	"change_type" text NOT NULL,
	"voting_power_before" integer,
	"voting_power_after" integer,
	"time" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "validators" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"address" text NOT NULL,
	"pub_key" text,
	"moniker" text,
	"voting_power" integer DEFAULT 0,
	"is_active" boolean DEFAULT true NOT NULL,
	"first_seen_height" integer,
	"last_seen_height" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validator_set_changes" ADD CONSTRAINT "validator_set_changes_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validators" ADD CONSTRAINT "validators_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "block_sigs_validator_height_idx" ON "block_signatures" USING btree ("validator_address","chain_id","height");--> statement-breakpoint
CREATE INDEX "block_sigs_chain_height_idx" ON "block_signatures" USING btree ("chain_id","height");--> statement-breakpoint
CREATE INDEX "blocks_chain_height_idx" ON "blocks" USING btree ("chain_id","height");--> statement-breakpoint
CREATE INDEX "blocks_chain_time_idx" ON "blocks" USING btree ("chain_id","time");--> statement-breakpoint
CREATE INDEX "vsc_chain_height_idx" ON "validator_set_changes" USING btree ("chain_id","height");--> statement-breakpoint
CREATE UNIQUE INDEX "validators_chain_address_idx" ON "validators" USING btree ("chain_id","address");--> statement-breakpoint
CREATE INDEX "validators_chain_idx" ON "validators" USING btree ("chain_id");