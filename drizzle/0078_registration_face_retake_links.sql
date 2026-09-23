CREATE TABLE "registration_face_retake_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"created_by_user_id" text NOT NULL,
	"code" varchar(50) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "registration_face_retake_links_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "registration_face_retake_links" ADD CONSTRAINT "registration_face_retake_links_reg_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "registration_face_retake_links" ADD CONSTRAINT "registration_face_retake_links_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "registration_face_retake_links" ADD CONSTRAINT "registration_face_retake_links_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "registration_face_retake_links_reg_idx" ON "registration_face_retake_links" USING btree ("registration_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "registration_face_retake_open_uidx" ON "registration_face_retake_links" USING btree ("registration_id") WHERE used_at IS NULL;
