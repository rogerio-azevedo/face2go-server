ALTER TYPE device_sync_job_kind ADD VALUE IF NOT EXISTS 'face.remove';
--> statement-breakpoint
ALTER TABLE clients ADD COLUMN enable_child_approve boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE registrations ADD COLUMN child_approval_required boolean DEFAULT false NOT NULL;
ALTER TABLE registrations ADD COLUMN child_approval_removal_pending boolean DEFAULT false NOT NULL;
ALTER TABLE registrations ADD COLUMN child_approval_requested_at timestamp;
ALTER TABLE registrations ADD COLUMN child_approval_requested_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE TABLE child_approval_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
 registration_id uuid NOT NULL REFERENCES registrations(id) ON DELETE RESTRICT,
 adult_registration_id uuid NOT NULL REFERENCES registrations(id) ON DELETE RESTRICT,
 unit_id uuid NOT NULL,
 token_hash text NOT NULL,
 token_encrypted text NOT NULL,
 email text NOT NULL,
 term_version text NOT NULL,
 term_content text NOT NULL,
 expires_at timestamp NOT NULL,
 accepted_at timestamp,
 canceled_at timestamp,
 verification_failures integer DEFAULT 0 NOT NULL,
 locked_until timestamp,
 email_sent_at timestamp,
 email_attempts integer DEFAULT 0 NOT NULL,
 email_next_attempt_at timestamp DEFAULT now() NOT NULL,
 email_locked_at timestamp,
 email_error text,
 created_at timestamp DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX child_approval_requests_token_uidx ON child_approval_requests(token_hash);
CREATE UNIQUE INDEX child_approval_requests_open_uidx ON child_approval_requests(registration_id, adult_registration_id) WHERE accepted_at IS NULL AND canceled_at IS NULL;
CREATE INDEX child_approval_requests_client_registration_idx ON child_approval_requests(client_id, registration_id);
--> statement-breakpoint
CREATE TABLE child_approval_consents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
 registration_id uuid NOT NULL REFERENCES registrations(id) ON DELETE RESTRICT,
 adult_registration_id uuid NOT NULL REFERENCES registrations(id) ON DELETE RESTRICT,
 request_id uuid NOT NULL REFERENCES child_approval_requests(id) ON DELETE RESTRICT,
 unit_id uuid NOT NULL,
 child_snapshot jsonb NOT NULL,
 adult_snapshot jsonb NOT NULL,
 term_version text NOT NULL,
 term_content text NOT NULL,
 term_hash text NOT NULL,
 confirmation_method text DEFAULT 'cpf' NOT NULL,
 accepted_at timestamp DEFAULT now() NOT NULL,
 revoked_at timestamp,
 revoked_by text,
 revocation_reason text
);
CREATE UNIQUE INDEX child_approval_consents_active_uidx ON child_approval_consents(registration_id, adult_registration_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX child_approval_consents_request_uidx ON child_approval_consents(request_id);
CREATE INDEX child_approval_consents_client_registration_idx ON child_approval_consents(client_id, registration_id);
--> statement-breakpoint
CREATE TABLE child_approval_faces (
 client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
 registration_id uuid NOT NULL REFERENCES registrations(id) ON DELETE RESTRICT,
 face_id integer NOT NULL
);
CREATE UNIQUE INDEX child_approval_faces_identity_uidx ON child_approval_faces(client_id, registration_id, face_id);
--> statement-breakpoint
-- Invalidar dentro da mudança de unidade: sair e voltar não reativa o aceite.
-- A trava é a mesma usada pelo worker durante a escrita física nos leitores.
CREATE FUNCTION invalidate_child_approval_on_unit_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f integer;
BEGIN
 IF OLD.unit_id IS NOT DISTINCT FROM NEW.unit_id THEN RETURN NEW; END IF;
 PERFORM id FROM registrations WHERE client_id = NEW.client_id AND id IN (
   SELECT registration_id FROM child_approval_consents WHERE client_id = NEW.client_id AND (registration_id = NEW.id OR adult_registration_id = NEW.id) AND revoked_at IS NULL
 ) ORDER BY id FOR UPDATE;
 FOR f IN
   SELECT DISTINCT face_id FROM (
     SELECT r.face_id FROM registrations r WHERE r.client_id = NEW.client_id AND r.id IN (
       SELECT c.registration_id FROM child_approval_consents c WHERE c.client_id = NEW.client_id AND (c.registration_id = NEW.id OR c.adult_registration_id = NEW.id) AND c.revoked_at IS NULL
     )
     UNION ALL
     SELECT f.face_id FROM child_approval_faces f WHERE f.client_id = NEW.client_id AND f.registration_id IN (
       SELECT c.registration_id FROM child_approval_consents c WHERE c.client_id = NEW.client_id AND (c.registration_id = NEW.id OR c.adult_registration_id = NEW.id) AND c.revoked_at IS NULL
     )
     UNION ALL
     SELECT m.face_id FROM client_members m WHERE m.client_id = NEW.client_id AND m.registration_id IN (
       SELECT c.registration_id FROM child_approval_consents c WHERE c.client_id = NEW.client_id AND (c.registration_id = NEW.id OR c.adult_registration_id = NEW.id) AND c.revoked_at IS NULL
     )
   ) faces WHERE face_id IS NOT NULL ORDER BY face_id
 LOOP
   PERFORM pg_advisory_xact_lock(hashtext(NEW.client_id::text), f);
 END LOOP;
 UPDATE registrations SET child_approval_removal_pending = true WHERE client_id = NEW.client_id AND id IN (
   SELECT registration_id FROM child_approval_consents WHERE client_id = NEW.client_id AND (registration_id = NEW.id OR adult_registration_id = NEW.id) AND revoked_at IS NULL
 );
 UPDATE child_approval_consents SET revoked_at = now(), revoked_by = 'system', revocation_reason = 'Unidade alterada: nova autorização necessária.'
 WHERE client_id = NEW.client_id AND (registration_id = NEW.id OR adult_registration_id = NEW.id) AND revoked_at IS NULL;
 UPDATE child_approval_requests SET canceled_at = now() WHERE client_id = NEW.client_id AND (registration_id = NEW.id OR adult_registration_id = NEW.id) AND accepted_at IS NULL AND canceled_at IS NULL;
 RETURN NEW;
END $$;
CREATE TRIGGER child_approval_unit_change AFTER UPDATE OF unit_id ON registrations FOR EACH ROW EXECUTE FUNCTION invalidate_child_approval_on_unit_change();
