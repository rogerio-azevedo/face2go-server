CREATE TABLE "legal_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"version" text NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"effective_date" date NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "legal_documents_type_version_unique" ON "legal_documents" USING btree ("type","version");
