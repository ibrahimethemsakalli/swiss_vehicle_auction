CREATE TABLE "SavedSearch" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "name" TEXT NOT NULL,
 "filters" JSONB NOT NULL,
 "alerts" BOOLEAN NOT NULL DEFAULT false,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "checkedId" TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX "SavedSearch_userId_name_key" ON "SavedSearch"("userId","name");
CREATE INDEX "SavedSearch_alerts_checkedAt_id_idx" ON "SavedSearch"("alerts","checkedAt","id");
