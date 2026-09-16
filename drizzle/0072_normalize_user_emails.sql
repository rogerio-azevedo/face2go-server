DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "user"
    GROUP BY lower(email)
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Não é possível normalizar e-mails: há duplicatas ignorando maiúsculas.';
  END IF;
END $$;

UPDATE "user" SET email = lower(email) WHERE email <> lower(email);

CREATE UNIQUE INDEX IF NOT EXISTS "user_email_lower_idx" ON "user" (lower(email));
