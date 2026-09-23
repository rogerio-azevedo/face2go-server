DO $$ BEGIN
  CREATE TYPE "reader_connection_mode" AS ENUM ('direct', 'auto_register');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "facial_readers" ADD COLUMN IF NOT EXISTS "connection_mode" "reader_connection_mode" DEFAULT 'direct' NOT NULL;
ALTER TABLE "facial_readers" ADD COLUMN IF NOT EXISTS "auto_register_device_id" varchar(64);
