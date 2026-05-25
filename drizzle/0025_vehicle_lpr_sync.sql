ALTER TABLE "vehicles"
  ADD COLUMN "lpr_sync_status" "device_sync_status" DEFAULT 'pending_sync'::"device_sync_status",
  ADD COLUMN "lpr_sync_error" text,
  ADD COLUMN "lpr_synced_at" timestamp;
