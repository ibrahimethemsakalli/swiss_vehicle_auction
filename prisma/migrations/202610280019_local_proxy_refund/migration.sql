CREATE TYPE "LocalProxyRefundStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TABLE "LocalProxyRefundCase" (
 "auctionId" TEXT NOT NULL,
 "requestedBy" TEXT NOT NULL,
 "reason" TEXT NOT NULL,
 "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "status" "LocalProxyRefundStatus" NOT NULL DEFAULT 'PENDING',
 "decisionNote" TEXT,
 "reviewedBy" TEXT,
 "reviewedAt" TIMESTAMP(3),
 CONSTRAINT "LocalProxyRefundCase_pkey" PRIMARY KEY ("auctionId")
);
CREATE TABLE "LocalProxyRefund" (
 "auctionId" TEXT NOT NULL,
 "amountCents" INTEGER NOT NULL,
 "currency" TEXT NOT NULL,
 "refundedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "LocalProxyRefund_pkey" PRIMARY KEY ("auctionId")
);
ALTER TABLE "LocalProxyRefundCase" ADD CONSTRAINT "LocalProxyRefundCase_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "LocalProxyCapture"("auctionId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LocalProxyRefund" ADD CONSTRAINT "LocalProxyRefund_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "LocalProxyRefundCase"("auctionId") ON DELETE RESTRICT ON UPDATE CASCADE;
