CREATE TABLE "RefundCaptureBinding" (
 "captureId" TEXT PRIMARY KEY REFERENCES "RefundCaptureState"(id) ON DELETE RESTRICT,
 "holdId" TEXT NOT NULL UNIQUE REFERENCES "PaymentHold"(id) ON DELETE RESTRICT
);
CREATE TABLE "RefundCase" (
 id TEXT PRIMARY KEY,
 "captureId" TEXT NOT NULL REFERENCES "RefundCaptureState"(id) ON DELETE RESTRICT,
 "amountMinor" INTEGER NOT NULL CHECK ("amountMinor" > 0),
 currency TEXT NOT NULL CHECK (currency = 'CHF'),
 "requesterId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
 "requestId" TEXT NOT NULL,
 reason TEXT NOT NULL CHECK (length(reason) BETWEEN 20 AND 2000),
 status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','IN_REVIEW','APPROVED','REJECTED')),
 version INTEGER NOT NULL DEFAULT 0,
 "policyVersion" TEXT,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("requesterId","requestId")
);
CREATE TABLE "RefundDecision" (
 id TEXT PRIMARY KEY,
 "caseId" TEXT NOT NULL REFERENCES "RefundCase"(id) ON DELETE RESTRICT,
 "reviewerId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
 "requestId" TEXT NOT NULL,
 outcome TEXT NOT NULL CHECK (outcome IN ('APPROVE','REJECT')),
 reason TEXT NOT NULL CHECK (length(reason) BETWEEN 20 AND 2000),
 "expectedVersion" INTEGER NOT NULL,
 "policyVersion" TEXT NOT NULL,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("reviewerId","requestId"),
 UNIQUE ("caseId","reviewerId")
);
CREATE TRIGGER refund_decision_immutable BEFORE UPDATE OR DELETE ON "RefundDecision"
FOR EACH ROW EXECUTE FUNCTION refund_append_only();
