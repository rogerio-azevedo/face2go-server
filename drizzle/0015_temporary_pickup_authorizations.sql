CREATE TYPE "public"."pickup_authorization_status" AS ENUM('active', 'used', 'expired', 'cancelled');--> statement-breakpoint
CREATE TABLE "temporary_pickup_authorizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"requested_by_responsible_id" uuid NOT NULL,
	"authorized_responsible_id" uuid,
	"guest_name" varchar(255),
	"guest_document" varchar(64),
	"guest_phone" varchar(32),
	"status" "pickup_authorization_status" DEFAULT 'active' NOT NULL,
	"valid_from" timestamptz NOT NULL,
	"valid_until" timestamptz NOT NULL,
	"notes" text,
	"used_at" timestamptz,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "temporary_pickup_target_xor_ck" CHECK ((
		"authorized_responsible_id" IS NOT NULL
		AND "guest_name" IS NULL
		AND "guest_document" IS NULL
	) OR (
		"authorized_responsible_id" IS NULL
		AND "guest_name" IS NOT NULL
		AND "guest_document" IS NOT NULL
	))
);--> statement-breakpoint
ALTER TABLE "temporary_pickup_authorizations" ADD CONSTRAINT "temporary_pickup_authorizations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "temporary_pickup_authorizations" ADD CONSTRAINT "temporary_pickup_authorizations_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "temporary_pickup_authorizations" ADD CONSTRAINT "temporary_pickup_authorizations_req_by_resp_fk" FOREIGN KEY ("requested_by_responsible_id") REFERENCES "public"."responsibles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "temporary_pickup_authorizations" ADD CONSTRAINT "temporary_pickup_authorizations_auth_resp_fk" FOREIGN KEY ("authorized_responsible_id") REFERENCES "public"."responsibles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "temporary_pickup_authorizations_client_id_idx" ON "temporary_pickup_authorizations" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "temporary_pickup_authorizations_student_id_idx" ON "temporary_pickup_authorizations" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "temporary_pickup_authorizations_requested_by_idx" ON "temporary_pickup_authorizations" USING btree ("requested_by_responsible_id");
