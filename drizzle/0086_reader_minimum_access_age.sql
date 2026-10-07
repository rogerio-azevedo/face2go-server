ALTER TABLE "facial_readers" ADD COLUMN "minimum_access_age" integer;
ALTER TABLE "facial_readers" ADD COLUMN "age_policy_version" integer DEFAULT 0 NOT NULL;
ALTER TABLE "facial_readers" ADD COLUMN "age_policy_status" varchar(20) DEFAULT 'applied' NOT NULL;
ALTER TABLE "facial_readers" ADD COLUMN "age_policy_error" text;
ALTER TABLE "facial_readers" ADD COLUMN "age_policy_applied_at" timestamp;

UPDATE "facial_readers"
SET "minimum_access_age" = 18
WHERE "restrict_minors" = true;

ALTER TABLE "facial_readers"
  ADD CONSTRAINT "facial_readers_minimum_access_age_check"
  CHECK ("minimum_access_age" IS NULL OR "minimum_access_age" BETWEEN 1 AND 18);

ALTER TABLE "facial_readers"
  ADD CONSTRAINT "facial_readers_age_policy_status_check"
  CHECK ("age_policy_status" IN ('applied', 'pending', 'failed'));
