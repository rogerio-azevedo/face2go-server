ALTER TABLE "responsibles" ADD COLUMN "photo_key" text;--> statement-breakpoint
ALTER TABLE "responsibles" ADD COLUMN "device_sync_status" "device_sync_status";--> statement-breakpoint
ALTER TABLE "responsibles" ADD COLUMN "device_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "responsibles" ADD COLUMN "device_sync_error" text;--> statement-breakpoint
