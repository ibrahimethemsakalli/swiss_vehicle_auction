CREATE TABLE "AdminWorkItem" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "kind" TEXT NOT NULL,
 "recordId" TEXT NOT NULL,
 "ownerId" TEXT,
 "version" INTEGER NOT NULL DEFAULT 1,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "AdminWorkItem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AdminWorkItem_kind_recordId_key" ON "AdminWorkItem"("kind","recordId");
CREATE INDEX "AdminWorkItem_ownerId_idx" ON "AdminWorkItem"("ownerId");
CREATE INDEX "Vehicle_createdAt_id_idx" ON "Vehicle"("createdAt","id");
CREATE INDEX "PaymentHold_createdAt_id_idx" ON "PaymentHold"("createdAt","id");
CREATE INDEX "Dispute_createdAt_id_idx" ON "Dispute"("createdAt","id");
CREATE INDEX "User_createdAt_id_idx" ON "User"("createdAt","id");
CREATE INDEX "OutboxEvent_kind_createdAt_id_idx" ON "OutboxEvent"("kind","createdAt","id");
