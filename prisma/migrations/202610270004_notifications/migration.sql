CREATE TABLE "Notification" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "eventKey" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "vehicleId" TEXT NOT NULL,
  "vehicleName" TEXT NOT NULL,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "Notification_userId_eventKey_key" ON "Notification"("userId", "eventKey");
CREATE INDEX "Notification_userId_createdAt_id_idx" ON "Notification"("userId", "createdAt", "id");
CREATE INDEX "Notification_userId_readAt_createdAt_id_idx" ON "Notification"("userId", "readAt", "createdAt", "id");
