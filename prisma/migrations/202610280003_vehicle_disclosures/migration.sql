ALTER TABLE "Vehicle" ALTER COLUMN "mfkDate" DROP NOT NULL;
ALTER TABLE "Vehicle" ADD COLUMN "mfkStatus" TEXT NOT NULL DEFAULT 'DATED',
 ADD COLUMN "damageDescription" TEXT,
 ADD COLUMN "batteryHealth" DOUBLE PRECISION;
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_mfk_state_check" CHECK (
 ("mfkStatus" = 'DATED' AND "mfkDate" IS NOT NULL) OR
 ("mfkStatus" IN ('NEVER','UNKNOWN') AND "mfkDate" IS NULL)
), ADD CONSTRAINT "Vehicle_battery_health_check" CHECK ("batteryHealth" BETWEEN 0 AND 100);
