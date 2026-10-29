ALTER TYPE "LocalProxyAuctionStatus" ADD VALUE 'COMPLETED';
ALTER TYPE "LocalProxyHoldStatus" ADD VALUE 'CAPTURED';
CREATE TABLE "LocalProxyCapture" (
 "auctionId" TEXT NOT NULL,
 "holdId" TEXT NOT NULL,
 "amountCents" INTEGER NOT NULL DEFAULT 3000,
 "currency" TEXT NOT NULL DEFAULT 'CHF',
 "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "LocalProxyCapture_pkey" PRIMARY KEY ("auctionId")
);
CREATE UNIQUE INDEX "LocalProxyCapture_holdId_key" ON "LocalProxyCapture"("holdId");
ALTER TABLE "LocalProxyCapture" ADD CONSTRAINT "LocalProxyCapture_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "LocalProxyAuction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LocalProxyCapture" ADD CONSTRAINT "LocalProxyCapture_holdId_fkey" FOREIGN KEY ("holdId") REFERENCES "LocalProxyHold"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
