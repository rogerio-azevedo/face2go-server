ALTER TABLE "temporary_pickup_authorizations"
ADD COLUMN IF NOT EXISTS "guest_plate_approval_status" "responsible_invitation_approval_status" DEFAULT 'approved' NOT NULL;

UPDATE "temporary_pickup_authorizations"
SET "guest_plate_approval_status" = 'approved'
WHERE "guest_plate_approval_status" IS NULL;
