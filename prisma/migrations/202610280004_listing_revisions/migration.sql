ALTER TYPE "VehicleStatus" ADD VALUE 'REJECTED';
CREATE TABLE "ListingRevision" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "vehicleId" TEXT NOT NULL,
 "version" INTEGER NOT NULL,
 "action" TEXT NOT NULL,
 "note" TEXT NOT NULL,
 "corrections" TEXT[] NOT NULL,
 "snapshot" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ListingRevision_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ListingRevision_vehicleId_version_action_key" ON "ListingRevision"("vehicleId","version","action");
CREATE INDEX "ListingRevision_vehicleId_createdAt_idx" ON "ListingRevision"("vehicleId","createdAt");
