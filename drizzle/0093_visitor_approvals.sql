CREATE TABLE "visitor_approval_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"adult_registration_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"visitor_snapshot" jsonb NOT NULL,
	"adult_snapshot" jsonb NOT NULL,
	"term_version" text NOT NULL,
	"term_content" text NOT NULL,
	"term_hash" text NOT NULL,
	"confirmation_method" text DEFAULT 'cpf' NOT NULL,
	"accepted_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	"revoked_by" text,
	"revocation_reason" text
);
--> statement-breakpoint
CREATE TABLE "visitor_approval_faces" (
	"client_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"face_id" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "visitor_approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"registration_id" uuid NOT NULL,
	"adult_registration_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"token_encrypted" text NOT NULL,
	"email" text NOT NULL,
	"term_version" text NOT NULL,
	"term_content" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	"canceled_at" timestamp,
	"verification_failures" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp,
	"email_sent_at" timestamp,
	"email_attempts" integer DEFAULT 0 NOT NULL,
	"email_next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"email_locked_at" timestamp,
	"email_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "enable_visitor_approve" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "is_visitor" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "visitor_approval_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "visitor_approval_removal_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "visitor_approval_requested_at" timestamp;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "visitor_approval_requested_by_user_id" text;--> statement-breakpoint
ALTER TABLE "visitor_approval_consents" ADD CONSTRAINT "visitor_approval_consents_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_approval_consents" ADD CONSTRAINT "visitor_approval_consents_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_approval_consents" ADD CONSTRAINT "visitor_approval_consents_adult_registration_id_registrations_id_fk" FOREIGN KEY ("adult_registration_id") REFERENCES "public"."registrations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_approval_consents" ADD CONSTRAINT "visitor_approval_consents_request_id_visitor_approval_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."visitor_approval_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_approval_faces" ADD CONSTRAINT "visitor_approval_faces_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_approval_faces" ADD CONSTRAINT "visitor_approval_faces_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_approval_requests" ADD CONSTRAINT "visitor_approval_requests_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_approval_requests" ADD CONSTRAINT "visitor_approval_requests_registration_id_registrations_id_fk" FOREIGN KEY ("registration_id") REFERENCES "public"."registrations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitor_approval_requests" ADD CONSTRAINT "visitor_approval_requests_adult_registration_id_registrations_id_fk" FOREIGN KEY ("adult_registration_id") REFERENCES "public"."registrations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "visitor_approval_consents_active_uidx" ON "visitor_approval_consents" USING btree ("registration_id","adult_registration_id") WHERE "visitor_approval_consents"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "visitor_approval_consents_request_uidx" ON "visitor_approval_consents" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "visitor_approval_consents_client_registration_idx" ON "visitor_approval_consents" USING btree ("client_id","registration_id");--> statement-breakpoint
CREATE UNIQUE INDEX "visitor_approval_faces_identity_uidx" ON "visitor_approval_faces" USING btree ("client_id","registration_id","face_id");--> statement-breakpoint
CREATE UNIQUE INDEX "visitor_approval_requests_token_uidx" ON "visitor_approval_requests" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "visitor_approval_requests_open_uidx" ON "visitor_approval_requests" USING btree ("registration_id","adult_registration_id") WHERE "visitor_approval_requests"."accepted_at" IS NULL AND "visitor_approval_requests"."canceled_at" IS NULL;--> statement-breakpoint
CREATE INDEX "visitor_approval_requests_client_registration_idx" ON "visitor_approval_requests" USING btree ("client_id","registration_id");--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_visitor_approval_requested_by_user_id_user_id_fk" FOREIGN KEY ("visitor_approval_requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
-- Replace the unit-only trigger with permanent invalidation for both policies.
DROP TRIGGER child_approval_unit_change ON registrations;
CREATE FUNCTION invalidate_person_approvals() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE domain text; ids uuid[]; f integer; beneficiary_change boolean; host_change boolean;
BEGIN
 beneficiary_change := OLD.unit_id IS DISTINCT FROM NEW.unit_id OR OLD.is_visitor IS DISTINCT FROM NEW.is_visitor;
 host_change := OLD.unit_id IS DISTINCT FROM NEW.unit_id
   OR (NEW.is_visitor AND NOT OLD.is_visitor)
   OR (OLD.status = 'approved' AND NEW.status <> 'approved')
   OR (OLD.is_active AND NOT NEW.is_active)
   OR OLD.birth_date IS DISTINCT FROM NEW.birth_date
   OR OLD.document IS DISTINCT FROM NEW.document;
 IF NOT beneficiary_change AND NOT host_change AND OLD.email IS NOT DISTINCT FROM NEW.email THEN RETURN NEW; END IF;
 FOREACH domain IN ARRAY ARRAY['child','visitor'] LOOP
   EXECUTE format('SELECT array_agg(DISTINCT registration_id ORDER BY registration_id) FROM %I WHERE client_id = $1 AND revoked_at IS NULL AND (($3 AND registration_id = $2) OR ($4 AND adult_registration_id = $2))', domain || '_approval_consents') INTO ids USING NEW.client_id, NEW.id, beneficiary_change, host_change;
   IF ids IS NOT NULL THEN
     PERFORM id FROM registrations WHERE client_id = NEW.client_id AND id = ANY(ids) ORDER BY id FOR UPDATE;
     FOR f IN SELECT DISTINCT face_id FROM (
       SELECT face_id FROM registrations WHERE client_id = NEW.client_id AND id = ANY(ids)
       UNION SELECT face_id FROM client_members WHERE client_id = NEW.client_id AND registration_id = ANY(ids)
       UNION SELECT face_id FROM child_approval_faces WHERE client_id = NEW.client_id AND registration_id = ANY(ids)
       UNION SELECT face_id FROM visitor_approval_faces WHERE client_id = NEW.client_id AND registration_id = ANY(ids)
     ) faces WHERE face_id IS NOT NULL ORDER BY face_id LOOP
       PERFORM pg_advisory_xact_lock(hashtext(NEW.client_id::text), f);
     END LOOP;
     EXECUTE format('UPDATE registrations SET %I = true WHERE client_id = $1 AND id = ANY($2)', domain || '_approval_removal_pending') USING NEW.client_id, ids;
     EXECUTE format('UPDATE %I SET revoked_at = now(), revoked_by = ''system'', revocation_reason = ''Unidade, identidade, classificação ou elegibilidade alterada: nova autorização necessária.'' WHERE client_id = $1 AND revoked_at IS NULL AND (($3 AND registration_id = $2) OR ($4 AND adult_registration_id = $2))', domain || '_approval_consents') USING NEW.client_id, NEW.id, beneficiary_change, host_change;
   END IF;
   EXECUTE format('UPDATE %I SET canceled_at = now() WHERE client_id = $1 AND accepted_at IS NULL AND canceled_at IS NULL AND (($3 AND registration_id = $2) OR (($4 OR $5) AND adult_registration_id = $2))', domain || '_approval_requests') USING NEW.client_id, NEW.id, beneficiary_change, host_change, OLD.email IS DISTINCT FROM NEW.email;
 END LOOP;
 IF NOT OLD.is_visitor AND NEW.is_visitor AND EXISTS(SELECT 1 FROM clients WHERE id = NEW.client_id AND enable_visitor_approve) THEN
   UPDATE registrations SET visitor_approval_required = true, visitor_approval_removal_pending = true, child_approval_requested_at = NULL, visitor_approval_requested_at = NULL WHERE client_id = NEW.client_id AND id = NEW.id;
 END IF;
 IF OLD.is_visitor IS DISTINCT FROM NEW.is_visitor THEN
   INSERT INTO registration_events(client_id, registration_id, type, body) VALUES (NEW.client_id, NEW.id, 'note', CASE WHEN NEW.is_visitor THEN 'Classificação alterada para visitante.' ELSE 'Classificação alterada de visitante para morador.' END);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER person_approval_change AFTER UPDATE OF unit_id, is_visitor, status, is_active, birth_date, document, email ON registrations FOR EACH ROW EXECUTE FUNCTION invalidate_person_approvals();
--> statement-breakpoint
-- An administrative rejection cancels every outstanding approval intention atomically.
CREATE FUNCTION cancel_person_approval_intents() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status = 'rejected' AND OLD.status IS DISTINCT FROM NEW.status THEN
   NEW.child_approval_requested_at := NULL; NEW.child_approval_requested_by_user_id := NULL;
   NEW.visitor_approval_requested_at := NULL; NEW.visitor_approval_requested_by_user_id := NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER person_approval_rejection BEFORE UPDATE OF status ON registrations FOR EACH ROW EXECUTE FUNCTION cancel_person_approval_intents();

--> statement-breakpoint
CREATE FUNCTION invalidate_member_host_approvals() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE domain text; ids uuid[]; f integer;
BEGIN
 IF NEW.registration_id IS NULL OR NOT (
   (OLD.is_active AND NOT NEW.is_active) OR (OLD.blocked_at IS NULL AND NEW.blocked_at IS NOT NULL)
   OR OLD.unit_id IS DISTINCT FROM NEW.unit_id OR OLD.birth_date IS DISTINCT FROM NEW.birth_date
 ) THEN RETURN NEW; END IF;
 FOREACH domain IN ARRAY ARRAY['child','visitor'] LOOP
   EXECUTE format('SELECT array_agg(DISTINCT registration_id) FROM %I WHERE client_id = $1 AND adult_registration_id = $2 AND revoked_at IS NULL', domain || '_approval_consents') INTO ids USING NEW.client_id, NEW.registration_id;
   IF ids IS NOT NULL THEN
     PERFORM id FROM registrations WHERE client_id = NEW.client_id AND id = ANY(ids) ORDER BY id FOR UPDATE;
     FOR f IN SELECT DISTINCT face_id FROM (
       SELECT face_id FROM registrations WHERE client_id = NEW.client_id AND id = ANY(ids)
       UNION SELECT face_id FROM client_members WHERE client_id = NEW.client_id AND registration_id = ANY(ids)
       UNION SELECT face_id FROM child_approval_faces WHERE client_id = NEW.client_id AND registration_id = ANY(ids)
       UNION SELECT face_id FROM visitor_approval_faces WHERE client_id = NEW.client_id AND registration_id = ANY(ids)
     ) faces WHERE face_id IS NOT NULL ORDER BY face_id LOOP PERFORM pg_advisory_xact_lock(hashtext(NEW.client_id::text), f); END LOOP;
     EXECUTE format('UPDATE registrations SET %I = true WHERE client_id = $1 AND id = ANY($2)', domain || '_approval_removal_pending') USING NEW.client_id, ids;
     EXECUTE format('UPDATE %I SET revoked_at = now(), revoked_by = ''system'', revocation_reason = ''Membro autorizador alterado ou indisponível: nova autorização necessária.'' WHERE client_id = $1 AND adult_registration_id = $2 AND revoked_at IS NULL', domain || '_approval_consents') USING NEW.client_id, NEW.registration_id;
   END IF;
   EXECUTE format('UPDATE %I SET canceled_at = now() WHERE client_id = $1 AND adult_registration_id = $2 AND canceled_at IS NULL AND accepted_at IS NULL', domain || '_approval_requests') USING NEW.client_id, NEW.registration_id;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER member_host_approval_change AFTER UPDATE OF is_active, blocked_at, unit_id, birth_date ON client_members FOR EACH ROW EXECUTE FUNCTION invalidate_member_host_approvals();

--> statement-breakpoint
-- Serialize activation with in-flight writes and durably reconcile previously enrolled people.
CREATE FUNCTION reconcile_enabled_person_approvals() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f integer;
BEGIN
 IF NOT ((NEW.enable_child_approve AND NOT OLD.enable_child_approve) OR (NEW.enable_visitor_approve AND NOT OLD.enable_visitor_approve)) THEN RETURN NEW; END IF;
 FOR f IN SELECT DISTINCT face_id FROM (
   SELECT face_id FROM registrations WHERE client_id = NEW.id AND (child_approval_required OR visitor_approval_required)
   UNION SELECT face_id FROM child_approval_faces WHERE client_id = NEW.id
   UNION SELECT face_id FROM visitor_approval_faces WHERE client_id = NEW.id
   UNION SELECT m.face_id FROM client_members m JOIN registrations r ON r.id = m.registration_id AND r.client_id = m.client_id WHERE m.client_id = NEW.id AND (r.child_approval_required OR r.visitor_approval_required)
 ) faces WHERE face_id IS NOT NULL ORDER BY face_id LOOP PERFORM pg_advisory_xact_lock(hashtext(NEW.id::text), f); END LOOP;
 IF NEW.enable_child_approve AND NOT OLD.enable_child_approve THEN UPDATE registrations SET child_approval_removal_pending = true WHERE client_id = NEW.id AND child_approval_required AND status IN ('approved','blocked'); END IF;
 IF NEW.enable_visitor_approve AND NOT OLD.enable_visitor_approve THEN UPDATE registrations SET visitor_approval_removal_pending = true WHERE client_id = NEW.id AND is_visitor AND visitor_approval_required AND status IN ('approved','blocked'); END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER person_approval_activation AFTER UPDATE OF enable_child_approve, enable_visitor_approve ON clients FOR EACH ROW EXECUTE FUNCTION reconcile_enabled_person_approvals();
