CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"responsible_id" uuid NOT NULL,
	"plate" varchar(10) NOT NULL,
	"brand" varchar(100) NOT NULL,
	"model" varchar(100) NOT NULL,
	"color" varchar(50) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_client_plate_unique" UNIQUE("client_id","plate")
);
--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_responsible_id_responsibles_id_fk" FOREIGN KEY ("responsible_id") REFERENCES "public"."responsibles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vehicles_responsible_id_idx" ON "vehicles" USING btree ("responsible_id");--> statement-breakpoint
CREATE INDEX "vehicles_client_id_idx" ON "vehicles" USING btree ("client_id");
