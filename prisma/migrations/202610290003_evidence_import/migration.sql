CREATE TABLE "SyntheticEvidenceImport" (
 id TEXT PRIMARY KEY,
 "scopeKey" TEXT NOT NULL,
 "batchId" TEXT NOT NULL,
 "payloadHash" TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('STAGED_SYNTHETIC','QUARANTINED')),
 manifest JSONB NOT NULL,
 pages JSONB,
 summary JSONB NOT NULL,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("scopeKey","batchId","payloadHash"),
 CHECK(manifest->>'provenance'='synthetic' AND manifest->'scope'->>'environment'='test')
);
CREATE TABLE "SyntheticEvidenceAttempt" (
 id TEXT PRIMARY KEY,
 "actorId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
 "requestId" TEXT NOT NULL,
 "inputHash" TEXT NOT NULL,
 "importId" TEXT NOT NULL REFERENCES "SyntheticEvidenceImport"(id) ON DELETE RESTRICT,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("actorId","requestId")
);
CREATE TABLE "SyntheticEvidenceEvent" (
 id TEXT PRIMARY KEY,
 "scopeKey" TEXT NOT NULL,
 "eventId" TEXT NOT NULL,
 "economicId" TEXT NOT NULL,
 "contentHash" TEXT NOT NULL,
 payload JSONB NOT NULL,
 UNIQUE("scopeKey","eventId"),
 UNIQUE("scopeKey","economicId")
);
CREATE TABLE "SyntheticEvidenceLink" (
 "importId" TEXT NOT NULL REFERENCES "SyntheticEvidenceImport"(id) ON DELETE RESTRICT,
 "eventId" TEXT NOT NULL REFERENCES "SyntheticEvidenceEvent"(id) ON DELETE RESTRICT,
 PRIMARY KEY("importId","eventId")
);
CREATE TRIGGER synthetic_import_immutable BEFORE UPDATE OR DELETE ON "SyntheticEvidenceImport" FOR EACH ROW EXECUTE FUNCTION refund_append_only();
CREATE TRIGGER synthetic_attempt_immutable BEFORE UPDATE OR DELETE ON "SyntheticEvidenceAttempt" FOR EACH ROW EXECUTE FUNCTION refund_append_only();
CREATE TRIGGER synthetic_event_immutable BEFORE UPDATE OR DELETE ON "SyntheticEvidenceEvent" FOR EACH ROW EXECUTE FUNCTION refund_append_only();
CREATE TRIGGER synthetic_link_immutable BEFORE UPDATE OR DELETE ON "SyntheticEvidenceLink" FOR EACH ROW EXECUTE FUNCTION refund_append_only();
