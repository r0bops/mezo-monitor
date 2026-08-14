CREATE TABLE "signature_retention" (
	"chain_id" integer PRIMARY KEY NOT NULL,
	"last_height" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "validator_signing_daily" (
	"chain_id" integer NOT NULL,
	"day" timestamp with time zone NOT NULL,
	"validator_address" text NOT NULL,
	"slots" integer NOT NULL,
	"signed" integer NOT NULL,
	CONSTRAINT "validator_signing_daily_chain_id_day_validator_address_pk" PRIMARY KEY("chain_id","day","validator_address")
);
--> statement-breakpoint
ALTER TABLE "validators" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "validators" ADD COLUMN "watched" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "signature_retention" ADD CONSTRAINT "signature_retention_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE cascade ON UPDATE no action;