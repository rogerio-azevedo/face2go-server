ALTER TABLE "shifts" ADD COLUMN "time_zone_index" integer;
--> statement-breakpoint
CREATE UNIQUE INDEX "shifts_client_time_zone_index_unique" ON "shifts" USING btree ("client_id","time_zone_index");
