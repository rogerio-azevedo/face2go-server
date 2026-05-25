CREATE TYPE "public"."camera_type" AS ENUM('lpr', 'ptz', 'general');--> statement-breakpoint
CREATE TABLE "cameras" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"type" "camera_type" DEFAULT 'general' NOT NULL,
	"brand" varchar(32) DEFAULT 'intelbras' NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"ip" varchar(255) NOT NULL,
	"port" integer DEFAULT 80 NOT NULL,
	"serial_number" varchar(120),
	"model" varchar(120),
	"location" text,
	"username" varchar(120),
	"password_encrypted" text,
	"device_id" varchar(64),
	"device_token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cameras_device_token_unique" UNIQUE("device_token"),
	CONSTRAINT "cameras_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX "cameras_device_id_unique" ON "cameras" USING btree ("device_id") WHERE "device_id" IS NOT NULL;
