UPDATE "responsible_invitations"
SET "status" = 'approved'
WHERE "face_approval_status" = 'approved'
  AND "plate_approval_status" = 'submitted'
  AND "status" = 'submitted';

ALTER TABLE "responsible_invitations"
DROP COLUMN IF EXISTS "plate_approval_status";
