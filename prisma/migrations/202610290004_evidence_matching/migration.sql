CREATE TABLE "SyntheticEvidenceMapping" (
 "eventId" TEXT PRIMARY KEY REFERENCES "SyntheticEvidenceEvent"(id) ON DELETE RESTRICT,
 "targetKind" TEXT NOT NULL CHECK("targetKind" IN ('CAPTURE','REFUND')),
 "targetId" TEXT NOT NULL,
 "actorId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT,
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 20 AND 2000),
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE("targetKind","targetId")
);
CREATE TRIGGER synthetic_mapping_immutable BEFORE UPDATE OR DELETE ON "SyntheticEvidenceMapping"
FOR EACH ROW EXECUTE FUNCTION refund_append_only();
