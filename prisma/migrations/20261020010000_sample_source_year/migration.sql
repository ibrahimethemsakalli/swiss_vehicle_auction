-- A source-stated model year is not an exact first-registration date.
ALTER TABLE "Vehicle" ALTER COLUMN "firstRegistration" DROP NOT NULL;
ALTER TABLE "Vehicle" ADD COLUMN "modelYear" INTEGER;
