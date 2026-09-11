ALTER TABLE "responsibles" ADD COLUMN "block_reason" text;
ALTER TABLE "responsibles" ADD COLUMN "blocked_at" timestamp;
ALTER TABLE "responsibles" ADD COLUMN "blocked_by_user_id" text;
ALTER TABLE "students" ADD COLUMN "block_reason" text;
ALTER TABLE "students" ADD COLUMN "blocked_at" timestamp;
ALTER TABLE "students" ADD COLUMN "blocked_by_user_id" text;
--> statement-breakpoint
ALTER TABLE "responsibles" ADD CONSTRAINT "responsibles_blocked_by_user_id_user_id_fk" FOREIGN KEY ("blocked_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "students" ADD CONSTRAINT "students_blocked_by_user_id_user_id_fk" FOREIGN KEY ("blocked_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
