CREATE TABLE IF NOT EXISTS "person_reader_sync" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL,
  "face_id" integer NOT NULL,
  "reader_id" uuid NOT NULL,
  "status" "device_sync_status" NOT NULL,
  "error" text,
  "synced_at" timestamp,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "person_reader_sync_client_face_reader_unique"
  ON "person_reader_sync" ("client_id", "face_id", "reader_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "person_reader_sync_client_face_idx"
  ON "person_reader_sync" ("client_id", "face_id");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "person_reader_sync"
    ADD CONSTRAINT "person_reader_sync_client_id_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "person_reader_sync"
    ADD CONSTRAINT "person_reader_sync_reader_id_facial_readers_id_fk"
    FOREIGN KEY ("reader_id") REFERENCES "public"."facial_readers"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
