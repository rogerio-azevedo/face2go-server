CREATE TABLE "company_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"feature_slug" varchar(100) NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"metadata" jsonb,
	"enabled_at" timestamp,
	"enabled_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_company_feature" UNIQUE("company_id","feature_slug")
);
--> statement-breakpoint
ALTER TABLE "company_features" ADD CONSTRAINT "company_features_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "company_features" ADD CONSTRAINT "company_features_enabled_by_user_id_fk" FOREIGN KEY ("enabled_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
