CREATE TABLE "RetentionProtection" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "conversationId" TEXT NOT NULL UNIQUE REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "reason" TEXT NOT NULL CHECK (char_length(btrim("reason")) BETWEEN 10 AND 1000),
 "createdById" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "reviewedById" TEXT REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "reviewedAt" TIMESTAMP(3),
 "reviewNote" TEXT,
 CONSTRAINT "RetentionProtection_review_complete" CHECK (
   ("reviewedAt" IS NULL AND "reviewedById" IS NULL AND "reviewNote" IS NULL) OR
   ("reviewedAt" IS NOT NULL AND "reviewedById" IS NOT NULL AND "reviewNote" IS NOT NULL AND char_length(btrim("reviewNote")) BETWEEN 10 AND 1000)
 )
);
CREATE INDEX "RetentionProtection_reviewedAt_id_idx" ON "RetentionProtection"("reviewedAt", "id");
