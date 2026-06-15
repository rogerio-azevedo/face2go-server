ALTER TABLE "client_members"
  ADD COLUMN IF NOT EXISTS "can_enroll_student_face" boolean DEFAULT false NOT NULL;
