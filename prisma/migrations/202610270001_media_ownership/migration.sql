CREATE TABLE "MediaAsset" (
  "id" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "vehicleId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'STAGING',
  "bytes" INTEGER NOT NULL,
  "width" INTEGER,
  "height" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MediaAsset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MediaAsset_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "MediaAsset_status_check" CHECK ("status" IN ('STAGING', 'READY', 'DELETING')),
  CONSTRAINT "MediaAsset_bytes_check" CHECK ("bytes" > 0)
);
CREATE UNIQUE INDEX "MediaAsset_filename_key" ON "MediaAsset"("filename");
CREATE INDEX "MediaAsset_ownerId_status_idx" ON "MediaAsset"("ownerId", "status");
CREATE INDEX "MediaAsset_status_vehicleId_createdAt_idx" ON "MediaAsset"("status", "vehicleId", "createdAt");
