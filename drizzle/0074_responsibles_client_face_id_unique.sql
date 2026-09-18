CREATE UNIQUE INDEX "responsibles_client_face_id_unique"
ON "responsibles" ("client_id", "face_id")
WHERE "face_id" IS NOT NULL;
