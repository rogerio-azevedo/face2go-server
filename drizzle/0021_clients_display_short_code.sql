ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "display_short_code" varchar(8);

CREATE UNIQUE INDEX IF NOT EXISTS "clients_display_short_code_unique" ON "clients" ("display_short_code");
