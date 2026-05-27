ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "cpf" varchar(14);
CREATE UNIQUE INDEX IF NOT EXISTS "user_cpf_unique" ON "user" ("cpf");
