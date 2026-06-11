-- Repara FK user_id em client_members (0045 referenciava "users" em vez de "user").
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'client_members_user_id_user_id_fk'
  ) THEN
    ALTER TABLE "client_members"
      ADD CONSTRAINT "client_members_user_id_user_id_fk"
      FOREIGN KEY ("user_id")
      REFERENCES "public"."user"("id")
      ON DELETE cascade
      ON UPDATE no action;
  END IF;
END $$;
