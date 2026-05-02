CREATE TYPE "public"."reader_brand" AS ENUM('intelbras', 'hikvision');--> statement-breakpoint
ALTER TABLE "facial_readers" ALTER COLUMN "serial_number" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "facial_readers" ADD COLUMN "brand" "reader_brand" DEFAULT 'intelbras' NOT NULL;--> statement-breakpoint
ALTER TABLE "facial_readers" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "facial_readers" ADD COLUMN "ip" varchar(45) DEFAULT '0.0.0.0' NOT NULL;--> statement-breakpoint
ALTER TABLE "facial_readers" ADD COLUMN "port" integer DEFAULT 80 NOT NULL;