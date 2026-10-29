ALTER TABLE "RefundCase" DROP CONSTRAINT "RefundCase_status_check";
ALTER TABLE "RefundCase" ADD CONSTRAINT "RefundCase_status_check"
 CHECK (status IN ('REQUESTED','IN_REVIEW','NEEDS_INFORMATION','APPROVED','REJECTED'));
ALTER TABLE "RefundCase"
 ADD COLUMN "previousCaseId" TEXT REFERENCES "RefundCase"(id) ON DELETE RESTRICT,
 ADD COLUMN "reviewBasis" TEXT CHECK ("reviewBasis" IN ('EQUIVALENT','NEW_EVIDENCE','ERROR')),
 ADD COLUMN "reviewRound" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "approvedVersion" INTEGER,
 ADD COLUMN "evidenceReadyAt" TIMESTAMPTZ,
 ADD COLUMN "informationDueAt" TIMESTAMPTZ,
 ADD COLUMN "lastStatusAt" TIMESTAMPTZ;
ALTER TABLE "RefundCase" ADD CHECK (("previousCaseId" IS NULL) = ("reviewBasis" IS NULL));
ALTER TABLE "RefundDecision" ADD COLUMN "reviewRound" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "RefundDecision" DROP CONSTRAINT "RefundDecision_caseId_reviewerId_key";
ALTER TABLE "RefundDecision" ADD UNIQUE ("caseId","reviewerId","reviewRound");
CREATE TABLE "RefundCaseActivity" (
 id TEXT PRIMARY KEY,
 "caseId" TEXT NOT NULL REFERENCES "RefundCase"(id) ON DELETE RESTRICT,
 "actorId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
 "requestId" TEXT NOT NULL,
 action TEXT NOT NULL,
 reason TEXT NOT NULL CHECK (length(reason) BETWEEN 20 AND 2000),
 "payloadHash" TEXT NOT NULL,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("actorId","requestId")
);
CREATE INDEX "RefundCaseActivity_caseId_createdAt_idx" ON "RefundCaseActivity"("caseId","createdAt");
CREATE TRIGGER refund_activity_immutable BEFORE UPDATE OR DELETE ON "RefundCaseActivity"
 FOR EACH ROW EXECUTE FUNCTION refund_append_only();
CREATE TABLE "RefundOperationalBlock" (
 id TEXT PRIMARY KEY,
 "scopeKey" TEXT NOT NULL,
 "captureId" TEXT REFERENCES "RefundCaptureState"(id) ON DELETE RESTRICT,
 kind TEXT NOT NULL CHECK (kind IN ('CHARGEBACK','CAPTURE_CONFLICT','ACCOUNT_CONFLICT')),
 "openedBy" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
 "openedReason" TEXT NOT NULL CHECK (length("openedReason") BETWEEN 20 AND 2000),
 "resolvedBy" TEXT REFERENCES "User"(id) ON DELETE RESTRICT,
 "resolvedReason" TEXT,
 "openedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "resolvedAt" TIMESTAMPTZ,
 CHECK (("resolvedBy" IS NULL AND "resolvedAt" IS NULL AND "resolvedReason" IS NULL) OR
 ("resolvedBy" IS NOT NULL AND "resolvedReason" IS NOT NULL AND "resolvedBy" <> "openedBy" AND "resolvedAt" IS NOT NULL AND length("resolvedReason") BETWEEN 20 AND 2000)),
 CHECK ((kind='ACCOUNT_CONFLICT' AND "captureId" IS NULL) OR (kind<>'ACCOUNT_CONFLICT' AND "captureId" IS NOT NULL))
);
CREATE INDEX "RefundOperationalBlock_scopeKey_idx" ON "RefundOperationalBlock"("scopeKey");
CREATE FUNCTION refund_block_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'immutable block history'; END IF;
 IF OLD."resolvedAt" IS NOT NULL OR
    (to_jsonb(NEW) - 'resolvedBy' - 'resolvedAt' - 'resolvedReason') IS DISTINCT FROM
    (to_jsonb(OLD) - 'resolvedBy' - 'resolvedAt' - 'resolvedReason') OR NEW."resolvedAt" IS NULL
 THEN RAISE EXCEPTION 'immutable block history'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER refund_block_history_guard BEFORE UPDATE OR DELETE ON "RefundOperationalBlock"
 FOR EACH ROW EXECUTE FUNCTION refund_block_history();
