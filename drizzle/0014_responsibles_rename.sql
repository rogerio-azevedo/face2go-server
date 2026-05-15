ALTER TYPE "public"."parent_relationship_type" RENAME TO "responsible_relationship_type";--> statement-breakpoint
ALTER TABLE "parents" RENAME TO "responsibles";--> statement-breakpoint
ALTER TABLE "parent_students" RENAME TO "responsible_students";--> statement-breakpoint
ALTER TABLE "responsible_students" RENAME COLUMN "parent_id" TO "responsible_id";--> statement-breakpoint
ALTER INDEX "parent_students_parent_student_unique" RENAME TO "responsible_students_responsible_student_unique";--> statement-breakpoint
