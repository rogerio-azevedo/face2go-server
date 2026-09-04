CREATE TABLE IF NOT EXISTS "person_reader_sync" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "face_id" integer NOT NULL,
  "reader_id" uuid NOT NULL REFERENCES "facial_readers"("id") ON DELETE CASCADE,
  "status" "device_sync_status" NOT NULL,
  "error" text,
  "synced_at" timestamp,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "person_reader_sync_client_face_reader_unique"
  ON "person_reader_sync" ("client_id", "face_id", "reader_id");

CREATE INDEX IF NOT EXISTS "person_reader_sync_client_face_idx"
  ON "person_reader_sync" ("client_id", "face_id");
