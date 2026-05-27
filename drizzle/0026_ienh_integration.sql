DO $$ BEGIN
 CREATE TYPE "public"."situacao_matricula" AS ENUM('enrolled', 'transferred', 'cancelled', 'pre_enrolled');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN IF NOT EXISTS "situacao_matricula" "situacao_matricula";
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "ienh_filial_code" integer;
