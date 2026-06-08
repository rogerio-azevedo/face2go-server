ALTER TABLE "temporary_pickup_authorizations"
  ADD COLUMN "linked_responsible_id" uuid;

ALTER TABLE "temporary_pickup_authorizations"
  ADD CONSTRAINT "temporary_pickup_authorizations_linked_responsible_id_responsibles_id_fk"
  FOREIGN KEY ("linked_responsible_id") REFERENCES "public"."responsibles"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
