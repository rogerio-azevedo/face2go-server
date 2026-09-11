ALTER TYPE "registration_status" ADD VALUE IF NOT EXISTS 'blocked';
--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "block_reason" text;
ALTER TABLE "registrations" ADD COLUMN "blocked_at" timestamp;
ALTER TABLE "registrations" ADD COLUMN "blocked_by_user_id" text;
ALTER TABLE "client_members" ADD COLUMN "block_reason" text;
ALTER TABLE "client_members" ADD COLUMN "blocked_at" timestamp;
ALTER TABLE "client_members" ADD COLUMN "blocked_by_user_id" text;
--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_blocked_by_user_id_user_id_fk" FOREIGN KEY ("blocked_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "client_members" ADD CONSTRAINT "client_members_blocked_by_user_id_user_id_fk" FOREIGN KEY ("blocked_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
