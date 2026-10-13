CREATE TABLE "location_person_moves" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "person_kind" varchar(20) NOT NULL,
  "person_id" uuid NOT NULL,
  "actor_user_id" text NOT NULL,
  "source_unit_id" uuid NOT NULL,
  "target_unit_id" uuid NOT NULL,
  "source_block_name" varchar(100) NOT NULL,
  "source_unit_name" varchar(50) NOT NULL,
  "target_block_name" varchar(100) NOT NULL,
  "target_unit_name" varchar(50) NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "location_person_moves_client_person_idx" ON "location_person_moves" ("client_id", "person_id", "created_at");
