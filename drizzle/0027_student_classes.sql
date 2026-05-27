CREATE TABLE "student_classes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"situacao_matricula" "situacao_matricula",
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "student_classes" ADD CONSTRAINT "student_classes_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "student_classes" ADD CONSTRAINT "student_classes_class_id_school_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."school_classes"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "student_classes_student_class_unique" ON "student_classes" USING btree ("student_id","class_id");
--> statement-breakpoint
INSERT INTO "student_classes" ("student_id", "class_id", "is_active")
SELECT "id", "class_id", true FROM "students" WHERE "class_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "students" DROP CONSTRAINT "students_class_id_school_classes_id_fk";
--> statement-breakpoint
ALTER TABLE "students" DROP COLUMN "class_id";
