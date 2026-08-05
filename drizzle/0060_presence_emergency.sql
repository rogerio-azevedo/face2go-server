DO $$ BEGIN
  CREATE TYPE "public"."access_person_type" AS ENUM('student', 'responsible', 'member', 'guest');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."presence_status" AS ENUM('in', 'out');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."presence_source" AS ENUM('facial', 'lpr');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."emergency_event_status" AS ENUM('active', 'resolved');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."srp_action" AS ENUM('hold', 'secure', 'lockdown', 'evacuate', 'shelter', 'other');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."emergency_checkin_status" AS ENUM('pending', 'safe', 'not_located', 'evacuated', 'injured');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."emergency_expected_status" AS ENUM('inside', 'added_manually');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "presence_state" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "client_id" uuid NOT NULL,
  "person_type" "access_person_type" NOT NULL,
  "person_id" uuid NOT NULL,
  "person_name" varchar(255) NOT NULL,
  "status" "presence_status" DEFAULT 'out' NOT NULL,
  "last_direction" "reader_direction",
  "last_event_at" timestamp,
  "last_source" "presence_source",
  "last_device_id" uuid,
  "last_device_name" varchar(255),
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "presence_state_client_person_unique"
  ON "presence_state" ("client_id", "person_type", "person_id");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "presence_state"
    ADD CONSTRAINT "presence_state_company_id_companies_id_fk"
    FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "presence_state"
    ADD CONSTRAINT "presence_state_client_id_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "emergency_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "client_id" uuid NOT NULL,
  "status" "emergency_event_status" DEFAULT 'active' NOT NULL,
  "srp_action" "srp_action",
  "reason" text,
  "triggered_by_user_id" text NOT NULL,
  "started_at" timestamp DEFAULT now() NOT NULL,
  "resolved_at" timestamp,
  "resolved_by_user_id" text,
  "panic_event_id" varchar(24),
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "emergency_events"
    ADD CONSTRAINT "emergency_events_company_id_companies_id_fk"
    FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "emergency_events"
    ADD CONSTRAINT "emergency_events_client_id_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "emergency_events"
    ADD CONSTRAINT "emergency_events_triggered_by_user_id_users_id_fk"
    FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "emergency_events"
    ADD CONSTRAINT "emergency_events_resolved_by_user_id_users_id_fk"
    FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "emergency_checkins" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "emergency_event_id" uuid NOT NULL,
  "person_type" "access_person_type" NOT NULL,
  "person_id" uuid NOT NULL,
  "person_name" varchar(255) NOT NULL,
  "class_id" uuid,
  "class_name" varchar(255),
  "expected_status" "emergency_expected_status" DEFAULT 'inside' NOT NULL,
  "status" "emergency_checkin_status" DEFAULT 'pending' NOT NULL,
  "status_note" text,
  "status_updated_by_user_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "status_updated_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "emergency_checkins_event_person_unique"
  ON "emergency_checkins" ("emergency_event_id", "person_type", "person_id");
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "emergency_checkins"
    ADD CONSTRAINT "emergency_checkins_emergency_event_id_emergency_events_id_fk"
    FOREIGN KEY ("emergency_event_id") REFERENCES "public"."emergency_events"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "emergency_checkins"
    ADD CONSTRAINT "emergency_checkins_class_id_school_classes_id_fk"
    FOREIGN KEY ("class_id") REFERENCES "public"."school_classes"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "emergency_checkins"
    ADD CONSTRAINT "emergency_checkins_status_updated_by_user_id_users_id_fk"
    FOREIGN KEY ("status_updated_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "emergency_status_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "emergency_event_id" uuid NOT NULL,
  "checkin_id" uuid NOT NULL,
  "from_status" "emergency_checkin_status",
  "to_status" "emergency_checkin_status" NOT NULL,
  "note" text,
  "by_user_id" text NOT NULL,
  "at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "emergency_status_log"
    ADD CONSTRAINT "emergency_status_log_emergency_event_id_emergency_events_id_fk"
    FOREIGN KEY ("emergency_event_id") REFERENCES "public"."emergency_events"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "emergency_status_log"
    ADD CONSTRAINT "emergency_status_log_checkin_id_emergency_checkins_id_fk"
    FOREIGN KEY ("checkin_id") REFERENCES "public"."emergency_checkins"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "emergency_status_log"
    ADD CONSTRAINT "emergency_status_log_by_user_id_users_id_fk"
    FOREIGN KEY ("by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "presence_state_company_client_status_idx"
  ON "presence_state" ("company_id", "client_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "emergency_events_company_client_status_idx"
  ON "emergency_events" ("company_id", "client_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "emergency_checkins_event_status_idx"
  ON "emergency_checkins" ("emergency_event_id", "status");
