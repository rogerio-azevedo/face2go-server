ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "timezone_offset_minutes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" DROP COLUMN IF EXISTS "timezone";
