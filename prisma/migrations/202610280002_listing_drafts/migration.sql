-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "draftId" TEXT;

-- CreateTable
CREATE TABLE "ListingDraft" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "step" INTEGER NOT NULL DEFAULT 0,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "vehicleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListingDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ListingDraft_vehicleId_key" ON "ListingDraft"("vehicleId");

-- CreateIndex
CREATE INDEX "ListingDraft_ownerId_status_updatedAt_idx" ON "ListingDraft"("ownerId", "status", "updatedAt");

-- AddForeignKey
ALTER TABLE "ListingDraft" ADD CONSTRAINT "ListingDraft_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingDraft" ADD CONSTRAINT "ListingDraft_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ListingDraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;
