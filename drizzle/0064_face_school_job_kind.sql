DO $$ BEGIN
  ALTER TYPE "device_sync_job_kind" ADD VALUE 'face.school';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
