ALTER TABLE "validator_location_ips" ADD COLUMN "lat" double precision;--> statement-breakpoint
ALTER TABLE "validator_location_ips" ADD COLUMN "lon" double precision;--> statement-breakpoint
ALTER TABLE "validator_locations" ADD COLUMN "lat" double precision;--> statement-breakpoint
ALTER TABLE "validator_locations" ADD COLUMN "lon" double precision;