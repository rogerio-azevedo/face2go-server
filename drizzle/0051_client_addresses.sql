CREATE TYPE "public"."geocoding_provider" AS ENUM('here', 'manual');--> statement-breakpoint
CREATE TYPE "public"."geocoding_precision" AS ENUM('rooftop', 'street', 'approximate');--> statement-breakpoint
CREATE TABLE "client_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"label" varchar(100) DEFAULT 'Principal' NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"cep" varchar(9),
	"street" varchar(255),
	"number" varchar(20),
	"complement" varchar(100),
	"neighborhood" varchar(100),
	"city" varchar(100),
	"state" varchar(2),
	"country" varchar(2) DEFAULT 'BR' NOT NULL,
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"geocoding_provider" "geocoding_provider" DEFAULT 'manual' NOT NULL,
	"geocoding_precision" "geocoding_precision",
	"here_location_id" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "client_addresses_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX "client_addresses_client_primary_unique" ON "client_addresses" USING btree ("client_id") WHERE "is_primary" = true;
