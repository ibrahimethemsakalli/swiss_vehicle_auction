CREATE TYPE "LocalProxyAuctionStatus" AS ENUM ('OPEN', 'WON', 'NO_BIDS', 'REVIEW', 'CANCELLED');
ALTER TABLE "LocalProxyAuction"
 ADD COLUMN "status" "LocalProxyAuctionStatus" NOT NULL DEFAULT 'OPEN',
 ADD COLUMN "winnerId" TEXT,
 ADD COLUMN "closedAt" TIMESTAMP(3),
 ADD COLUMN "cancelledAt" TIMESTAMP(3);
CREATE INDEX "LocalProxyAuction_status_endsAt_idx" ON "LocalProxyAuction"("status", "endsAt");
