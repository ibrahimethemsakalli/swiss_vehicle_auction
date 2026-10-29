ALTER TABLE "SupportTicket" ADD COLUMN "ownerId" TEXT REFERENCES "User"("id") ON DELETE RESTRICT;
ALTER TABLE "Notification" ADD COLUMN "supportTicketId" TEXT REFERENCES "SupportTicket"("id") ON DELETE RESTRICT;
CREATE INDEX "Notification_supportTicketId_idx" ON "Notification"("supportTicketId");
CREATE TABLE "SupportRead" ("entryId" TEXT NOT NULL REFERENCES "SupportEntry"("id") ON DELETE RESTRICT, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT, "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY("entryId","userId"));
CREATE INDEX "SupportRead_userId_idx" ON "SupportRead"("userId");
CREATE TABLE "SupportAssignment" ("id" TEXT PRIMARY KEY,"ticketId" TEXT NOT NULL REFERENCES "SupportTicket"("id") ON DELETE RESTRICT,"actorId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,"commandId" TEXT NOT NULL,"payload" TEXT NOT NULL,"previousOwnerId" TEXT,"ownerId" TEXT,"reason" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX "SupportAssignment_actorId_commandId_key" ON "SupportAssignment"("actorId","commandId");
CREATE INDEX "SupportAssignment_ticketId_createdAt_idx" ON "SupportAssignment"("ticketId","createdAt");
