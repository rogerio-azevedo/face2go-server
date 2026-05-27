CREATE UNIQUE INDEX "school_classes_client_name_year_unique" ON "school_classes" USING btree ("client_id","name","year");
