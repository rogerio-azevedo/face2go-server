ALTER TABLE "client_members" ADD COLUMN "shift_id" uuid;--> statement-breakpoint
ALTER TABLE "client_members" ADD CONSTRAINT "client_members_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE set null ON UPDATE no action;
