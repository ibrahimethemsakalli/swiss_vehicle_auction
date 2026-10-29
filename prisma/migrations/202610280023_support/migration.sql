CREATE TABLE "SupportTicket" ("id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT, "subject" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'OPEN' CHECK ("status" IN ('OPEN','WAITING_USER','RESOLVED','CLOSED')), "version" INTEGER NOT NULL DEFAULT 0, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "SupportEntry" ("id" TEXT PRIMARY KEY, "ticketId" TEXT NOT NULL REFERENCES "SupportTicket"("id") ON DELETE RESTRICT, "actorId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT, "commandId" TEXT NOT NULL, "payload" TEXT NOT NULL, "body" TEXT NOT NULL, "staff" BOOLEAN NOT NULL, "status" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX "SupportEntry_actorId_commandId_key" ON "SupportEntry"("actorId","commandId");
CREATE INDEX "SupportEntry_ticketId_createdAt_idx" ON "SupportEntry"("ticketId","createdAt");
CREATE INDEX "SupportTicket_userId_updatedAt_idx" ON "SupportTicket"("userId","updatedAt");
CREATE INDEX "SupportTicket_status_updatedAt_idx" ON "SupportTicket"("status","updatedAt");
