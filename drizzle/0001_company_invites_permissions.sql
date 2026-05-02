CREATE TABLE "invite_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"company_id" uuid NOT NULL,
	"role" "company_user_role" NOT NULL,
	"expires_at" timestamp,
	"used_count" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invite_links_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "company_user_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_user_id" uuid NOT NULL,
	"feature_slug" varchar(100) NOT NULL,
	"actions" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "unique_company_user_feature" UNIQUE("company_user_id","feature_slug")
);
--> statement-breakpoint
CREATE TABLE "features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(100) NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "features_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "company_users" ADD COLUMN "job_title" varchar(120);--> statement-breakpoint
ALTER TABLE "invite_links" ADD CONSTRAINT "invite_links_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_user_permissions" ADD CONSTRAINT "company_user_permissions_company_user_id_company_users_id_fk" FOREIGN KEY ("company_user_id") REFERENCES "public"."company_users"("id") ON DELETE cascade ON UPDATE no action;