CREATE TYPE "public"."client_display_device_type" AS ENUM('lpr_camera', 'facial_reader');--> statement-breakpoint
CREATE TABLE "client_display_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"device_type" "client_display_device_type" NOT NULL,
	"device_id" uuid NOT NULL,
	CONSTRAINT "client_display_devices_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX "client_display_devices_client_device_unique" ON "client_display_devices" USING btree ("client_id","device_type","device_id");
