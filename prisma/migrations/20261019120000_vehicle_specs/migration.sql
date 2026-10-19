ALTER TABLE "Vehicle"
ADD COLUMN "fuelType" TEXT,
ADD COLUMN "transmission" TEXT,
ADD COLUMN "bodyType" TEXT,
ADD COLUMN "drivetrain" TEXT,
ADD COLUMN "condition" TEXT,
ADD COLUMN "exteriorColor" TEXT,
ADD COLUMN "accidentHistory" TEXT,
ADD COLUMN "warranty" TEXT,
ADD COLUMN "fuelConsumption" DOUBLE PRECISION,
ADD COLUMN "electricConsumption" DOUBLE PRECISION,
ADD COLUMN "co2Emissions" INTEGER,
ADD COLUMN "rangeKm" INTEGER,
ADD COLUMN "batteryCapacity" DOUBLE PRECISION,
ADD COLUMN "seats" INTEGER,
ADD COLUMN "doors" INTEGER;
CREATE INDEX "Vehicle_status_make_model_idx" ON "Vehicle"("status", "make", "model");
