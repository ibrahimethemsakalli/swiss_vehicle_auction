ALTER TABLE "Vehicle" ADD COLUMN "interiorColor" TEXT, ADD COLUMN "energyClass" TEXT, ADD COLUMN "euroNorm" TEXT, ADD COLUMN "equipment" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
