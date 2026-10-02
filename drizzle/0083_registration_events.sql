CREATE TYPE "public"."registration_event_type" AS ENUM('note', 'approved', 'rejected', 'blocked', 'unblocked', 'deleted', 'restored');
--> statement-breakpoint
CREATE TABLE "registration_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registration_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"type" "registration_event_type" NOT NULL,
	"body" text,
	"author_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "registration_events_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "registration_events_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "registration_events_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX "registration_events_reg_created_idx" ON "registration_events" USING btree ("registration_id","created_at");
--> statement-breakpoint
INSERT INTO "registration_events" ("registration_id", "client_id", "type", "body", "author_user_id", "created_at")
SELECT "id", "client_id", 'approved', NULL, "approved_by_user_id", "approved_at"
FROM "registrations"
WHERE "approved_at" IS NOT NULL AND "status" IN ('approved', 'blocked');
--> statement-breakpoint
INSERT INTO "registration_events" ("registration_id", "client_id", "type", "body", "author_user_id", "created_at")
SELECT "id", "client_id", 'rejected', "rejection_notes", "approved_by_user_id", "approved_at"
FROM "registrations"
WHERE "status" = 'rejected' AND "approved_at" IS NOT NULL;
--> statement-breakpoint
INSERT INTO "registration_events" ("registration_id", "client_id", "type", "body", "author_user_id", "created_at")
SELECT "id", "client_id", 'blocked', "block_reason", "blocked_by_user_id", COALESCE("blocked_at", "updated_at", now())
FROM "registrations"
WHERE "status" = 'blocked';
