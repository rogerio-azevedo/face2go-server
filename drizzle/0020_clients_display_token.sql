ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "display_token" uuid;

CREATE UNIQUE INDEX IF NOT EXISTS "clients_display_token_unique" ON "clients" ("display_token");
