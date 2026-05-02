CREATE TYPE "public"."registration_status" AS ENUM('draft', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "registration_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"created_by_user_id" text NOT NULL,
	"code" varchar(50) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "registration_links_code_unique" UNIQUE("code")
);--> statement-breakpoint
ALTER TABLE "registration_links" ADD CONSTRAINT "registration_links_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registration_links" ADD CONSTRAINT "registration_links_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE TABLE "registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_link_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"name" varchar(255),
	"document" varchar(32),
	"phone" varchar(32),
	"email" varchar(255),
	"face_image_key" text,
	"additional_data" jsonb,
	"status" "registration_status" DEFAULT 'draft' NOT NULL,
	"approved_by_user_id" text,
	"approved_at" timestamp,
	"rejection_notes" text,
	"submitted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_registration_link_id_registration_links_id_fk" FOREIGN KEY ("registration_link_id") REFERENCES "public"."registration_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_approved_by_user_id_user_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
