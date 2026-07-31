-- Remove vínculo de login em membros de clientes que não são escola.
-- Corrige auto-link global por CPF que expôs condomínios no app escolar.
UPDATE client_members cm
SET
  user_id = NULL,
  updated_at = NOW()
FROM clients c
WHERE
  cm.client_id = c.id
  AND c.type != 'school'
  AND cm.user_id IS NOT NULL;
