DROP INDEX "device_sync_jobs_dedupe_active";

CREATE UNIQUE INDEX "device_sync_jobs_dedupe_active"
  ON "device_sync_jobs" ("dedupe_key")
  WHERE "status" = 'queued';
