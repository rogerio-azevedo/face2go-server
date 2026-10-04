CREATE TABLE "client_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "client_blocks_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX "client_blocks_client_name_active_uidx" ON "client_blocks" USING btree ("client_id", lower("name")) WHERE "is_active" = true;
--> statement-breakpoint
CREATE TABLE "client_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"block_id" uuid NOT NULL,
	"name" varchar(50) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "client_units_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "client_units_block_id_client_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."client_blocks"("id") ON DELETE restrict ON UPDATE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX "client_units_block_name_active_uidx" ON "client_units" USING btree ("block_id", lower("name")) WHERE "is_active" = true;
--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "unit_id" uuid;
--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_unit_id_client_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."client_units"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "registrations_unit_id_idx" ON "registrations" USING btree ("unit_id");
--> statement-breakpoint
ALTER TABLE "client_members" ADD COLUMN "unit_id" uuid;
--> statement-breakpoint
ALTER TABLE "client_members" ADD CONSTRAINT "client_members_unit_id_client_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."client_units"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "client_members_unit_id_idx" ON "client_members" USING btree ("unit_id");
--> statement-breakpoint
INSERT INTO "client_blocks" ("client_id", "name")
SELECT client_id, name
FROM (
	SELECT DISTINCT ON (client_id, lower(name))
		client_id,
		name
	FROM (
		SELECT r.client_id, left(btrim(r.additional_data->>'block'), 100) AS name
		FROM "registrations" r
		INNER JOIN "clients" c ON c.id = r.client_id AND c.type = 'condominium'
		WHERE btrim(coalesce(r.additional_data->>'block', '')) <> ''
			AND btrim(coalesce(r.additional_data->>'unit', '')) <> ''
		UNION ALL
		SELECT m.client_id, left(btrim(m.additional_data->>'block'), 100) AS name
		FROM "client_members" m
		INNER JOIN "clients" c ON c.id = m.client_id AND c.type = 'condominium'
		WHERE btrim(coalesce(m.additional_data->>'block', '')) <> ''
			AND btrim(coalesce(m.additional_data->>'unit', '')) <> ''
	) raw
	ORDER BY client_id, lower(name), name
) picked;
--> statement-breakpoint
INSERT INTO "client_units" ("client_id", "block_id", "name")
SELECT client_id, block_id, unit_name
FROM (
	SELECT DISTINCT ON (block_id, lower(unit_name))
		client_id,
		block_id,
		unit_name
	FROM (
		SELECT
			r.client_id,
			b.id AS block_id,
			left(btrim(r.additional_data->>'unit'), 50) AS unit_name
		FROM "registrations" r
		INNER JOIN "clients" c ON c.id = r.client_id AND c.type = 'condominium'
		INNER JOIN "client_blocks" b
			ON b.client_id = r.client_id
			AND lower(b.name) = lower(left(btrim(r.additional_data->>'block'), 100))
			AND b.is_active = true
		WHERE btrim(coalesce(r.additional_data->>'block', '')) <> ''
			AND btrim(coalesce(r.additional_data->>'unit', '')) <> ''
		UNION ALL
		SELECT
			m.client_id,
			b.id AS block_id,
			left(btrim(m.additional_data->>'unit'), 50) AS unit_name
		FROM "client_members" m
		INNER JOIN "clients" c ON c.id = m.client_id AND c.type = 'condominium'
		INNER JOIN "client_blocks" b
			ON b.client_id = m.client_id
			AND lower(b.name) = lower(left(btrim(m.additional_data->>'block'), 100))
			AND b.is_active = true
		WHERE btrim(coalesce(m.additional_data->>'block', '')) <> ''
			AND btrim(coalesce(m.additional_data->>'unit', '')) <> ''
	) raw
	ORDER BY block_id, lower(unit_name), unit_name
) picked;
--> statement-breakpoint
UPDATE "registrations" AS r
SET "unit_id" = u.id
FROM "clients" c, "client_blocks" b, "client_units" u
WHERE c.id = r.client_id
	AND c.type = 'condominium'
	AND b.client_id = r.client_id
	AND lower(b.name) = lower(left(btrim(r.additional_data->>'block'), 100))
	AND u.block_id = b.id
	AND u.client_id = r.client_id
	AND lower(u.name) = lower(left(btrim(r.additional_data->>'unit'), 50))
	AND btrim(coalesce(r.additional_data->>'block', '')) <> ''
	AND btrim(coalesce(r.additional_data->>'unit', '')) <> '';
--> statement-breakpoint
UPDATE "client_members" AS m
SET "unit_id" = u.id
FROM "clients" c, "client_blocks" b, "client_units" u
WHERE c.id = m.client_id
	AND c.type = 'condominium'
	AND b.client_id = m.client_id
	AND lower(b.name) = lower(left(btrim(m.additional_data->>'block'), 100))
	AND u.block_id = b.id
	AND u.client_id = m.client_id
	AND lower(u.name) = lower(left(btrim(m.additional_data->>'unit'), 50))
	AND btrim(coalesce(m.additional_data->>'block', '')) <> ''
	AND btrim(coalesce(m.additional_data->>'unit', '')) <> '';
--> statement-breakpoint
UPDATE "registrations" AS r
SET "additional_data" = jsonb_set(
	jsonb_set(coalesce(r.additional_data, '{}'::jsonb), '{block}', to_jsonb(b.name), true),
	'{unit}',
	to_jsonb(u.name),
	true
)
FROM "client_units" u
INNER JOIN "client_blocks" b ON b.id = u.block_id
WHERE r.unit_id = u.id;
--> statement-breakpoint
UPDATE "client_members" AS m
SET "additional_data" = jsonb_set(
	jsonb_set(coalesce(m.additional_data, '{}'::jsonb), '{block}', to_jsonb(b.name), true),
	'{unit}',
	to_jsonb(u.name),
	true
)
FROM "client_units" u
INNER JOIN "client_blocks" b ON b.id = u.block_id
WHERE m.unit_id = u.id;
