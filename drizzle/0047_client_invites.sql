CREATE TABLE IF NOT EXISTS "client_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"requested_by_member_id" uuid NOT NULL,
	"guest_name" varchar(255),
	"guest_document" varchar(64),
	"guest_phone" varchar(32),
	"guest_link_code" varchar(50),
	"guest_approval_status" "pickup_guest_approval_status" DEFAULT 'pending_face' NOT NULL,
	"guest_face_image_key" text,
	"guest_face_id" integer,
	"guest_face_sync_status" "device_sync_status",
	"guest_face_synced_at" timestamptz,
	"guest_face_sync_error" text,
	"guest_vehicle_plate" varchar(10),
	"guest_vehicle_brand" varchar(100),
	"guest_vehicle_model" varchar(100),
	"guest_vehicle_color" varchar(50),
	"guest_vehicle_lpr_sync_status" "device_sync_status",
	"guest_vehicle_lpr_synced_at" timestamptz,
	"guest_vehicle_lpr_sync_error" text,
	"status" "pickup_authorization_status" DEFAULT 'active' NOT NULL,
	"valid_from" timestamptz NOT NULL,
	"valid_until" timestamptz NOT NULL,
	"notes" text,
	"used_at" timestamptz,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM pg_constraint WHERE conname = 'client_invites_client_id_clients_id_fk'
 ) THEN
   ALTER TABLE "client_invites" ADD CONSTRAINT "client_invites_client_id_clients_id_fk"
     FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM pg_constraint WHERE conname = 'client_invites_requested_by_member_id_client_members_id_fk'
 ) THEN
   ALTER TABLE "client_invites" ADD CONSTRAINT "client_invites_requested_by_member_id_client_members_id_fk"
     FOREIGN KEY ("requested_by_member_id") REFERENCES "public"."client_members"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "client_invites_guest_link_code_unique" ON "client_invites" ("guest_link_code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_invites_client_id_idx" ON "client_invites" ("client_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_invites_requested_by_member_id_idx" ON "client_invites" ("requested_by_member_id");
