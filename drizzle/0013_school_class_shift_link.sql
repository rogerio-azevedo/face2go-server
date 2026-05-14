ALTER TABLE "school_classes" ALTER COLUMN "shift" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "school_classes" ALTER COLUMN "shift" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "school_classes" ADD COLUMN "shift_id" uuid;--> statement-breakpoint
ALTER TABLE "school_classes" ADD CONSTRAINT "school_classes_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE set null ON UPDATE no action;