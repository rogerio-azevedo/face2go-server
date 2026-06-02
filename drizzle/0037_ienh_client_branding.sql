-- Branding runtime IENH para clientes com integração TOTVS (filiais 1–3).
UPDATE "clients"
SET
  "primary_color" = '#fff112',
  "logo_url" = COALESCE(NULLIF(TRIM("logo_url"), ''), 'https://www.face2go.com.br/brands/ienh-access/logo.png'),
  "updated_at" = NOW()
WHERE "ienh_filial_code" IS NOT NULL;
