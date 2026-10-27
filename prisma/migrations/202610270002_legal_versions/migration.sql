CREATE TABLE "LegalRelease" ("id" TEXT PRIMARY KEY, "version" TEXT NOT NULL UNIQUE, "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE "LegalCurrent" ("id" TEXT PRIMARY KEY DEFAULT 'current', "releaseId" TEXT NOT NULL UNIQUE REFERENCES "LegalRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE, CHECK ("id" = 'current'));
CREATE TABLE "LegalDocument" (
  "id" TEXT PRIMARY KEY,
  "releaseId" TEXT NOT NULL REFERENCES "LegalRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('TERMS','PRIVACY')),
  "locale" TEXT NOT NULL CHECK ("locale" IN ('de','fr','it','en')),
  "title" TEXT NOT NULL,
  "content" JSONB NOT NULL,
  "contentHash" TEXT NOT NULL,
  UNIQUE ("releaseId","kind","locale")
);
CREATE TABLE "LegalAcceptance" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "releaseId" TEXT NOT NULL REFERENCES "LegalRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "termsDocumentId" TEXT NOT NULL REFERENCES "LegalDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "privacyDocumentId" TEXT NOT NULL REFERENCES "LegalDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "locale" TEXT NOT NULL CHECK ("locale" IN ('de','fr','it','en')),
  "source" TEXT NOT NULL CHECK ("source" IN ('REGISTRATION','ACCOUNT')),
  "termsAccepted" BOOLEAN NOT NULL CHECK ("termsAccepted"),
  "privacyAcknowledged" BOOLEAN NOT NULL CHECK ("privacyAcknowledged"),
  "eligibilityDeclared" BOOLEAN NOT NULL CHECK ("eligibilityDeclared"),
  "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("userId","releaseId")
);
CREATE INDEX "LegalAcceptance_userId_acceptedAt_idx" ON "LegalAcceptance"("userId","acceptedAt");
ALTER TABLE "Vehicle" ADD COLUMN "legalAcceptanceId" TEXT REFERENCES "LegalAcceptance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Bid" ADD COLUMN "legalAcceptanceId" TEXT REFERENCES "LegalAcceptance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentHold" ADD COLUMN "legalAcceptanceId" TEXT REFERENCES "LegalAcceptance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Published snapshots and receipts are append-only through the application.
-- Direct DB maintenance may delete unreferenced test fixtures, but cannot edit history.
CREATE FUNCTION prevent_legal_update() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'Legal history is immutable'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER immutable_legal_release BEFORE UPDATE ON "LegalRelease" FOR EACH ROW EXECUTE FUNCTION prevent_legal_update();
CREATE TRIGGER immutable_legal_document BEFORE UPDATE ON "LegalDocument" FOR EACH ROW EXECUTE FUNCTION prevent_legal_update();
CREATE TRIGGER immutable_legal_acceptance BEFORE UPDATE ON "LegalAcceptance" FOR EACH ROW EXECUTE FUNCTION prevent_legal_update();

CREATE FUNCTION validate_legal_acceptance() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "LegalDocument" WHERE "id"=NEW."termsDocumentId" AND "releaseId"=NEW."releaseId" AND "kind"='TERMS' AND "locale"=NEW."locale")
    OR NOT EXISTS (SELECT 1 FROM "LegalDocument" WHERE "id"=NEW."privacyDocumentId" AND "releaseId"=NEW."releaseId" AND "kind"='PRIVACY' AND "locale"=NEW."locale")
  THEN RAISE EXCEPTION 'Legal receipt document mismatch'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER legal_receipt_documents BEFORE INSERT ON "LegalAcceptance" FOR EACH ROW EXECUTE FUNCTION validate_legal_acceptance();
