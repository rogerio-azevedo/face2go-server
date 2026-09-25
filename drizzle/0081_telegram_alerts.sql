CREATE TYPE "public"."telegram_chat_type" AS ENUM('private', 'group', 'supergroup');
--> statement-breakpoint
CREATE TABLE "telegram_chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"chat_id" text NOT NULL,
	"chat_type" "telegram_chat_type" NOT NULL,
	"title" text,
	"username" text,
	"user_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_chats_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "telegram_chats_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE "telegram_link_tokens" (
	"token" text PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"target_user_id" text,
	"created_by_user_id" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_link_tokens_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "telegram_link_tokens_target_user_id_user_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "telegram_link_tokens_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_chats_client_chat_unique" ON "telegram_chats" USING btree ("client_id","chat_id");
--> statement-breakpoint
CREATE INDEX "telegram_chats_chat_id_idx" ON "telegram_chats" USING btree ("chat_id");
