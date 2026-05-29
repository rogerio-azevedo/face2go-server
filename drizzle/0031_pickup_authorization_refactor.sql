CREATE TYPE "public"."pickup_guest_approval_status" AS ENUM('pending_face', 'submitted', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "pickup_authorization_students" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"authorization_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pickup_auth_students_auth_student_unique" UNIQUE("authorization_id","student_id")
);--> statement-breakpoint
INSERT INTO "pickup_authorization_students" ("authorization_id", "student_id")
SELECT "id", "student_id" FROM "temporary_pickup_authorizations";--> statement-breakpoint
UPDATE "temporary_pickup_authorizations" t
SET
	"guest_name" = COALESCE(t."guest_name", r."name"),
	"guest_document" = COALESCE(t."guest_document", COALESCE(r."document", 'LEGADO'))
FROM "responsibles" r
WHERE t."authorized_responsible_id" = r."id"
	AND (t."guest_name" IS NULL OR t."guest_document" IS NULL);--> statement-breakpoint
UPDATE "temporary_pickup_authorizations"
SET
	"guest_name" = 'Convidado',
	"guest_document" = 'N/A'
WHERE "guest_name" IS NULL OR "guest_document" IS NULL;--> statement-breakpoint
ALTER TABLE "temporary_pickup_authorizations" DROP CONSTRAINT "temporary_pickup_target_xor_ck";--> statement-breakpoint
ALTER TABLE "temporary_pickup_authorizations" DROP CONSTRAINT "temporary_pickup_authorizations_student_id_students_id_fk";--> statement-breakpoint
ALTER TABLE "temporary_pickup_authorizations" DROP CONSTRAINT "temporary_pickup_authorizations_auth_resp_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "temporary_pickup_authorizations_student_id_idx";--> statement-breakpoint
ALTER TABLE "temporary_pickup_authorizations" DROP COLUMN "student_id";--> statement-breakpoint
ALTER TABLE "temporary_pickup_authorizations" DROP COLUMN "authorized_responsible_id";--> statement-breakpoint
ALTER TABLE "temporary_pickup_authorizations" ALTER COLUMN "guest_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "temporary_pickup_authorizations" ALTER COLUMN "guest_document" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "temporary_pickup_authorizations" ADD COLUMN "guest_link_code" varchar(50);--> statement-breakpoint
ALTER TABLE "temporary_pickup_authorizations" ADD COLUMN "guest_approval_status" "pickup_guest_approval_status" DEFAULT 'pending_face' NOT NULL;--> statement-breakpoint
ALTER TABLE "temporary_pickup_authorizations" ADD COLUMN "guest_face_image_key" text;--> statement-breakpoint
ALTER TABLE "temporary_pickup_authorizations" ADD COLUMN "guest_face_id" integer;--> statement-breakpoint
ALTER TABLE "temporary_pickup_authorizations" ADD COLUMN "guest_face_sync_status" "device_sync_status";--> statement-breakpoint
ALTER TABLE "temporary_pickup_authorizations" ADD COLUMN "guest_face_synced_at" timestamptz;--> statement-breakpoint
ALTER TABLE "temporary_pickup_authorizations" ADD COLUMN "guest_face_sync_error" text;--> statement-breakpoint
ALTER TABLE "temporary_pickup_authorizations" ADD COLUMN "guest_vehicle_plate" varchar(10);--> statement-breakpoint
ALTER TABLE "temporary_pickup_authorizations" ADD COLUMN "guest_vehicle_brand" varchar(100);--> statement-breakpoint
ALTER TABLE "temporary_pickup_authorizations" ADD COLUMN "guest_vehicle_model" varchar(100);--> statement-breakpoint
ALTER TABLE "temporary_pickup_authorizations" ADD COLUMN "guest_vehicle_color" varchar(50);--> statement-breakpoint
ALTER TABLE "temporary_pickup_authorizations" ADD COLUMN "guest_vehicle_lpr_sync_status" "device_sync_status";--> statement-breakpoint
ALTER TABLE "temporary_pickup_authorizations" ADD COLUMN "guest_vehicle_lpr_synced_at" timestamptz;--> statement-breakpoint
ALTER TABLE "temporary_pickup_authorizations" ADD COLUMN "guest_vehicle_lpr_sync_error" text;--> statement-breakpoint
ALTER TABLE "pickup_authorization_students" ADD CONSTRAINT "pickup_authorization_students_authorization_id_temporary_pickup_authorizations_id_fk" FOREIGN KEY ("authorization_id") REFERENCES "public"."temporary_pickup_authorizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickup_authorization_students" ADD CONSTRAINT "pickup_authorization_students_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "temporary_pickup_authorizations" ADD CONSTRAINT "temporary_pickup_guest_link_code_unique" UNIQUE("guest_link_code");--> statement-breakpoint
CREATE INDEX "pickup_authorization_students_authorization_id_idx" ON "pickup_authorization_students" USING btree ("authorization_id");--> statement-breakpoint
CREATE INDEX "pickup_authorization_students_student_id_idx" ON "pickup_authorization_students" USING btree ("student_id");
