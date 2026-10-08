ALTER TABLE "facial_readers" ADD COLUMN "firmware_version" varchar(255);--> statement-breakpoint
ALTER TABLE "facial_readers" ADD COLUMN "device_info_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "facial_readers" ADD COLUMN "device_info_last_error" text;
