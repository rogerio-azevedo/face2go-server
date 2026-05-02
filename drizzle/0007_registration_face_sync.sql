CREATE TYPE "device_sync_status" AS ENUM ('pending_sync', 'synced', 'sync_failed');

ALTER TABLE "registrations"
  ADD COLUMN "face_id" integer;

ALTER TABLE "registrations"
  ADD COLUMN "device_sync_status" "device_sync_status";

ALTER TABLE "registrations"
  ADD COLUMN "device_synced_at" timestamp;

ALTER TABLE "registrations"
  ADD COLUMN "device_sync_error" text;

ALTER TABLE "registrations"
  ADD CONSTRAINT "registrations_client_id_face_id_unique" UNIQUE ("client_id", "face_id");

CREATE TABLE "client_face_counters" (
  "client_id" uuid PRIMARY KEY NOT NULL REFERENCES "clients" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  "last_face_id" integer DEFAULT 0 NOT NULL
);
