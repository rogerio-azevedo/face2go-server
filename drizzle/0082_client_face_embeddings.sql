CREATE TABLE "client_face_embeddings" (
	"client_id" uuid NOT NULL,
	"face_id" integer NOT NULL,
	"photo_key" text NOT NULL,
	"blocked" boolean DEFAULT false NOT NULL,
	"embedding" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "client_face_embeddings_client_id_face_id_pk" PRIMARY KEY("client_id","face_id"),
	CONSTRAINT "client_face_embeddings_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action
);
