ALTER TABLE "Vehicle" ADD COLUMN "city" TEXT, ADD COLUMN "postalCode" TEXT;
CREATE INDEX "Vehicle_status_city_idx" ON "Vehicle"("status", "city");
CREATE INDEX "Vehicle_status_postalCode_idx" ON "Vehicle"("status", "postalCode");
