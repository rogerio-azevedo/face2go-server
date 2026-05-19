CREATE TYPE "public"."reader_direction" AS ENUM('in', 'out');--> statement-breakpoint
ALTER TABLE "facial_readers" ADD COLUMN "direction" "reader_direction";--> statement-breakpoint
