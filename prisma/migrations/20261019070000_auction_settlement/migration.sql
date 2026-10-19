-- CreateTable
CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "bidId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AWAITING_CONFIRMATION',
    "outcome" TEXT,
    "sellerConfirmedAt" TIMESTAMP(3),
    "defaultReportedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_vehicleId_key" ON "Settlement"("vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_bidId_key" ON "Settlement"("bidId");

-- CreateIndex
CREATE INDEX "Settlement_status_createdAt_idx" ON "Settlement"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Settlement" ADD CONSTRAINT "Settlement_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "Bid"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
