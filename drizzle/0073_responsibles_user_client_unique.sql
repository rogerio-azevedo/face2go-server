-- Aplicar DEPOIS de `pnpm db:split-merged-responsibles --apply`.
-- Falha se ainda houver dois responsáveis da mesma escola no mesmo user_id.

CREATE UNIQUE INDEX "responsibles_user_client_unique"
ON "responsibles" ("user_id", "client_id")
WHERE "user_id" IS NOT NULL;
