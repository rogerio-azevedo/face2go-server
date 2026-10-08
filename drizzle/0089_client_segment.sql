ALTER TABLE "clients" ADD COLUMN "segment" varchar(32);--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_segment_type_check" CHECK ("segment" IS NULL OR ("segment" = 'condo_market' AND "type" = 'condominium'));
