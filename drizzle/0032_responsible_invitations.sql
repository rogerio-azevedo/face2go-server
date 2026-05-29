CREATE TYPE "public"."responsible_invitation_status" AS ENUM('pending', 'submitted', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."responsible_invitation_approval_status" AS ENUM('pending', 'submitted', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "responsible_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"inviter_responsible_id" uuid NOT NULL,
	"guest_link_code" varchar(50),
	"status" "responsible_invitation_status" DEFAULT 'pending' NOT NULL,
	"face_approval_status" "responsible_invitation_approval_status" DEFAULT 'pending' NOT NULL,
	"plate_approval_status" "responsible_invitation_approval_status" DEFAULT 'pending' NOT NULL,
	"submitted_name" varchar(255),
	"submitted_email" varchar(255),
	"submitted_phone" varchar(32),
	"submitted_document" varchar(32),
	"submitted_password_hash" text,
	"face_image_key" text,
	"vehicle_plate" varchar(10),
	"vehicle_brand" varchar(100),
	"vehicle_model" varchar(100),
	"vehicle_color" varchar(50),
	"created_responsible_id" uuid,
	"face_sync_status" "device_sync_status",
	"face_synced_at" timestamp with time zone,
	"face_sync_error" text,
	"plate_lpr_sync_status" "device_sync_status",
	"plate_lpr_synced_at" timestamp with time zone,
	"plate_lpr_sync_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "responsible_invitation_guest_link_code_unique" UNIQUE("guest_link_code")
);--> statement-breakpoint
CREATE TABLE "responsible_invitation_students" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invitation_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"relationship_type" "responsible_relationship_type" DEFAULT 'other' NOT NULL,
	"is_authorized_pickup" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "responsible_invitation_students_invitation_student_unique" UNIQUE("invitation_id","student_id")
);--> statement-breakpoint
ALTER TABLE "responsible_invitations" ADD CONSTRAINT "responsible_invitations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responsible_invitations" ADD CONSTRAINT "responsible_invitations_inviter_responsible_id_responsibles_id_fk" FOREIGN KEY ("inviter_responsible_id") REFERENCES "public"."responsibles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responsible_invitations" ADD CONSTRAINT "responsible_invitations_created_responsible_id_responsibles_id_fk" FOREIGN KEY ("created_responsible_id") REFERENCES "public"."responsibles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responsible_invitation_students" ADD CONSTRAINT "responsible_invitation_students_invitation_id_responsible_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."responsible_invitations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responsible_invitation_students" ADD CONSTRAINT "responsible_invitation_students_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;
