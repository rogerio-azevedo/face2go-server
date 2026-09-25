DO $$ BEGIN
  ALTER TYPE "device_sync_job_status" ADD VALUE 'canceled';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "device_sync_jobs" ADD COLUMN IF NOT EXISTS "locked_by" text;
--> statement-breakpoint
ALTER TABLE "device_sync_jobs" ADD COLUMN IF NOT EXISTS "heartbeat_at" timestamp;
--> statement-breakpoint
ALTER TABLE "device_sync_jobs" ADD COLUMN IF NOT EXISTS "attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "device_sync_jobs" ADD COLUMN IF NOT EXISTS "cancel_requested" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "device_sync_jobs_client_idx";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_sync_jobs_client_created_idx"
  ON "device_sync_jobs" ("client_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "device_sync_jobs_target_active_idx"
  ON "device_sync_jobs" ("kind", "target_id")
  WHERE "status" IN ('queued', 'running');
