CREATE TYPE "device_sync_job_kind" AS ENUM (
  'face.person',
  'face.reader',
  'lpr.vehicle',
  'lpr.camera'
);

CREATE TYPE "device_sync_job_status" AS ENUM (
  'queued',
  'running',
  'done',
  'failed'
);

CREATE TABLE "device_sync_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "kind" "device_sync_job_kind" NOT NULL,
  "client_id" uuid NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "target_id" uuid NOT NULL,
  "force" boolean DEFAULT false NOT NULL,
  "status" "device_sync_job_status" DEFAULT 'queued' NOT NULL,
  "dedupe_key" text NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "processed" integer DEFAULT 0 NOT NULL,
  "total" integer DEFAULT 0 NOT NULL,
  "error" text,
  "created_by" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "started_at" timestamp,
  "finished_at" timestamp
);

CREATE UNIQUE INDEX "device_sync_jobs_dedupe_active"
  ON "device_sync_jobs" ("dedupe_key")
  WHERE "status" IN ('queued', 'running');

CREATE INDEX "device_sync_jobs_status_created_idx"
  ON "device_sync_jobs" ("status", "created_at");

CREATE INDEX "device_sync_jobs_client_idx"
  ON "device_sync_jobs" ("client_id");

CREATE TABLE "vehicle_camera_sync" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "vehicle_id" uuid NOT NULL REFERENCES "vehicles"("id") ON DELETE CASCADE,
  "camera_id" uuid NOT NULL REFERENCES "cameras"("id") ON DELETE CASCADE,
  "status" "device_sync_status" NOT NULL,
  "error" text,
  "synced_at" timestamp,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX "vehicle_camera_sync_client_vehicle_camera_unique"
  ON "vehicle_camera_sync" ("client_id", "vehicle_id", "camera_id");

CREATE INDEX "vehicle_camera_sync_client_vehicle_idx"
  ON "vehicle_camera_sync" ("client_id", "vehicle_id");
