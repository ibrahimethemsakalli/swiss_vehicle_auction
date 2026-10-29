ALTER TABLE "RetentionProtection" DROP CONSTRAINT "RetentionProtection_conversationId_key";
ALTER TABLE "RetentionProtection" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE', ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1, ADD COLUMN "releasedAt" TIMESTAMP(3);
ALTER TABLE "RetentionProtection" ADD CONSTRAINT "RetentionProtection_state" CHECK (("status"='ACTIVE' AND "releasedAt" IS NULL) OR ("status"='RELEASED' AND "releasedAt" IS NOT NULL));
CREATE UNIQUE INDEX "RetentionProtection_one_active" ON "RetentionProtection"("conversationId") WHERE "status"='ACTIVE';
CREATE INDEX "RetentionProtection_conversationId_status_idx" ON "RetentionProtection"("conversationId","status");
CREATE TABLE "RetentionReviewRequest" (
 "id" TEXT PRIMARY KEY, "protectionId" TEXT NOT NULL REFERENCES "RetentionProtection"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "requesterId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "reasonCode" TEXT NOT NULL CHECK ("reasonCode" IN ('NEW_EVIDENCE','WRONG_CONVERSATION','REASON_CHANGED','CASE_CHANGED')),
 "note" TEXT NOT NULL, "evidence" JSONB NOT NULL, "snapshot" TEXT NOT NULL, "protectionVersion" INTEGER NOT NULL,
 "version" INTEGER NOT NULL DEFAULT 1, "status" TEXT NOT NULL DEFAULT 'OPEN' CHECK ("status" IN ('OPEN','NEEDS_INFO','KEPT','WITHDRAWN','RELEASED')),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "RetentionReviewRequest_protectionId_createdAt_id_idx" ON "RetentionReviewRequest"("protectionId","createdAt","id");
CREATE UNIQUE INDEX "RetentionReviewRequest_one_open" ON "RetentionReviewRequest"("protectionId") WHERE "status" IN ('OPEN','NEEDS_INFO');
CREATE TABLE "RetentionReviewEvent" (
 "id" TEXT PRIMARY KEY, "protectionId" TEXT NOT NULL REFERENCES "RetentionProtection"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "requestId" TEXT REFERENCES "RetentionReviewRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "actorId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "kind" TEXT NOT NULL, "payload" JSONB NOT NULL, "commandId" TEXT NOT NULL, "commandHash" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "RetentionReviewEvent_actorId_commandId_key" ON "RetentionReviewEvent"("actorId","commandId");
CREATE INDEX "RetentionReviewEvent_protectionId_createdAt_id_idx" ON "RetentionReviewEvent"("protectionId","createdAt","id");
-- Preserve original identifiers, notes and timestamps; never reinterpret a legacy review as release.
INSERT INTO "RetentionReviewEvent" ("id","protectionId","actorId","kind","payload","commandId","commandHash","createdAt")
SELECT 'legacy-create-'||id,id,"createdById",'LEGACY_CREATE',jsonb_build_object('note',reason),'legacy-create-'||id,'legacy',"createdAt" FROM "RetentionProtection";
INSERT INTO "RetentionReviewEvent" ("id","protectionId","actorId","kind","payload","commandId","commandHash","createdAt")
SELECT 'legacy-review-'||id,id,"reviewedById",'LEGACY_REVIEW',jsonb_build_object('note',"reviewNote"),'legacy-review-'||id,'legacy',"reviewedAt" FROM "RetentionProtection" WHERE "reviewedAt" IS NOT NULL;
CREATE FUNCTION retention_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'RETENTION_EVENT_IMMUTABLE'; END $$;
CREATE TRIGGER retention_event_immutable BEFORE UPDATE OR DELETE ON "RetentionReviewEvent" FOR EACH ROW EXECUTE FUNCTION retention_event_immutable();
