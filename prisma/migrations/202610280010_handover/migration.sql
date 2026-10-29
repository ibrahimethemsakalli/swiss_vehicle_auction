CREATE TABLE "HandoverRevision" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "settlementId" TEXT NOT NULL,
 "version" INTEGER NOT NULL,
 "payload" JSONB NOT NULL,
 "snapshot" JSONB NOT NULL,
 "contentHash" TEXT NOT NULL,
 "createdById" TEXT NOT NULL,
 "createdByRole" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "buyerAcknowledgedAt" TIMESTAMP(3),
 "sellerAcknowledgedAt" TIMESTAMP(3),
 CONSTRAINT "HandoverRevision_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "HandoverRevision_settlementId_version_key" ON "HandoverRevision"("settlementId","version");
