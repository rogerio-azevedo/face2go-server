CREATE TABLE IF NOT EXISTS "client_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(50) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"user_id" text,
	"registration_id" uuid,
	"name" varchar(255) NOT NULL,
	"email" varchar(255),
	"phone" varchar(32),
	"document" varchar(32),
	"birth_date" date,
	"photo_key" text,
	"face_id" integer,
	"device_sync_status" "device_sync_status",
	"device_synced_at" timestamp,
	"device_sync_error" text,
	"push_token" text,
	"additional_data" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'client_roles_client_id_clients_id_fk'
  ) THEN
    ALTER TABLE "client_roles"
      ADD CONSTRAINT "client_roles_client_id_clients_id_fk"
      FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'client_members_client_id_clients_id_fk'
  ) THEN
    ALTER TABLE "client_members"
      ADD CONSTRAINT "client_members_client_id_clients_id_fk"
      FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'client_members_role_id_client_roles_id_fk'
  ) THEN
    ALTER TABLE "client_members"
      ADD CONSTRAINT "client_members_role_id_client_roles_id_fk"
      FOREIGN KEY ("role_id") REFERENCES "public"."client_roles"("id")
      ON DELETE restrict ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'client_members_user_id_user_id_fk'
  ) THEN
    ALTER TABLE "client_members"
      ADD CONSTRAINT "client_members_user_id_user_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "public"."user"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'client_members_registration_id_registrations_id_fk'
  ) THEN
    ALTER TABLE "client_members"
      ADD CONSTRAINT "client_members_registration_id_registrations_id_fk"
      FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id")
      ON DELETE set null ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "client_roles_client_slug_unique" ON "client_roles" USING btree ("client_id","slug");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "client_members_client_face_id_unique" ON "client_members" USING btree ("client_id","face_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "client_members_registration_unique" ON "client_members" USING btree ("registration_id");
--> statement-breakpoint
ALTER TABLE "vehicles" ALTER COLUMN "responsible_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "vehicles" ADD COLUMN IF NOT EXISTS "member_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vehicles_member_id_client_members_id_fk'
  ) THEN
    ALTER TABLE "vehicles"
      ADD CONSTRAINT "vehicles_member_id_client_members_id_fk"
      FOREIGN KEY ("member_id") REFERENCES "public"."client_members"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'vehicles_owner_check'
  ) THEN
    ALTER TABLE "vehicles"
      ADD CONSTRAINT "vehicles_owner_check" CHECK (
        ("responsible_id" IS NOT NULL AND "member_id" IS NULL)
        OR ("responsible_id" IS NULL AND "member_id" IS NOT NULL)
      );
  END IF;
END $$;
