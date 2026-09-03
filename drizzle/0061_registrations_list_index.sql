CREATE INDEX IF NOT EXISTS "registrations_client_status_submitted_at_idx"
  ON "registrations" USING btree ("client_id", "status", "submitted_at");
