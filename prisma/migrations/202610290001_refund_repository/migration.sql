CREATE TABLE "RefundRuntimePolicy" (
  "id" TEXT PRIMARY KEY,
  "policy" JSONB NOT NULL,
  "actors" JSONB NOT NULL
);
-- No seed/default policy: deployment cannot implicitly authorize money movement.
CREATE TABLE "RefundCaptureState" (
  "id" TEXT PRIMARY KEY,
  "scopeKey" TEXT NOT NULL,
  "captureRef" TEXT NOT NULL,
  "version" INTEGER NOT NULL CHECK ("version" >= 0),
  "snapshot" JSONB NOT NULL,
  UNIQUE ("scopeKey", "captureRef"),
  CHECK (("snapshot"->>'version')::integer = "version")
);
CREATE TABLE "RefundCommandState" (
  "key" TEXT PRIMARY KEY,
  "captureId" TEXT NOT NULL REFERENCES "RefundCaptureState"("id") ON DELETE RESTRICT,
  "caseId" TEXT NOT NULL,
  "decisionVersion" INTEGER NOT NULL,
  "leaseToken" TEXT,
  "leaseUntil" TIMESTAMPTZ,
  UNIQUE ("captureId", "caseId", "decisionVersion")
);
CREATE TABLE "RefundStateEvent" (
  "id" BIGSERIAL PRIMARY KEY,
  "captureId" TEXT NOT NULL REFERENCES "RefundCaptureState"("id") ON DELETE RESTRICT,
  "version" INTEGER NOT NULL,
  "kind" TEXT NOT NULL,
  "actorId" TEXT,
  "snapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("captureId", "version")
);
CREATE TABLE "RefundReceipt" (
  "scopeKey" TEXT NOT NULL,
  "refundRef" TEXT NOT NULL,
  "captureId" TEXT NOT NULL REFERENCES "RefundCaptureState"("id") ON DELETE RESTRICT,
  "commandKey" TEXT NOT NULL UNIQUE REFERENCES "RefundCommandState"("key") ON DELETE RESTRICT,
  "amountMinor" INTEGER NOT NULL CHECK ("amountMinor" > 0),
  "currency" TEXT NOT NULL CHECK ("currency" = 'CHF'),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("scopeKey", "refundRef")
);
CREATE FUNCTION refund_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'REFUND_APPEND_ONLY'; END;
$$;
CREATE TRIGGER refund_event_immutable BEFORE UPDATE OR DELETE ON "RefundStateEvent"
FOR EACH ROW EXECUTE FUNCTION refund_append_only();
CREATE TRIGGER refund_receipt_immutable BEFORE UPDATE OR DELETE ON "RefundReceipt"
FOR EACH ROW EXECUTE FUNCTION refund_append_only();
