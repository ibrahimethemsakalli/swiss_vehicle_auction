-- Historical provenance cannot be inferred from creation time or admin approval.
ALTER TABLE "Vehicle" ADD COLUMN "dataDeclaredAt" TIMESTAMP(3);
ALTER TABLE "Vehicle" ADD COLUMN "dataCorrectedAt" TIMESTAMP(3);
ALTER TABLE "Vehicle" ADD COLUMN "dataCorrectedFields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
