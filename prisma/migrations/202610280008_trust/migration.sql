CREATE TABLE "ListingReport" (
 "id" TEXT PRIMARY KEY, "vehicleId" TEXT NOT NULL REFERENCES "Vehicle"("id") ON UPDATE CASCADE,
 "reporterId" TEXT NOT NULL REFERENCES "User"("id") ON UPDATE CASCADE,
 "category" TEXT NOT NULL, "note" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'OPEN',
 "decision" TEXT, "decisionNote" TEXT, "reviewedBy" TEXT, "reviewedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ListingReport_vehicleId_reporterId_key" ON "ListingReport"("vehicleId","reporterId");
CREATE INDEX "ListingReport_status_createdAt_id_idx" ON "ListingReport"("status","createdAt","id");
CREATE INDEX "ListingReport_reporterId_createdAt_id_idx" ON "ListingReport"("reporterId","createdAt","id");
CREATE TABLE "SaleReview" (
 "id" TEXT PRIMARY KEY, "settlementId" TEXT NOT NULL REFERENCES "Settlement"("id") ON UPDATE CASCADE,
 "authorId" TEXT NOT NULL REFERENCES "User"("id") ON UPDATE CASCADE,
 "recipientId" TEXT NOT NULL REFERENCES "User"("id") ON UPDATE CASCADE,
 "rating" INTEGER NOT NULL CHECK ("rating" BETWEEN 1 AND 5), "note" TEXT NOT NULL,
 "response" TEXT, "responseAt" TIMESTAMP(3), "status" TEXT NOT NULL DEFAULT 'PUBLISHED', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "SaleReview_distinct_parties" CHECK ("authorId" <> "recipientId")
);
CREATE UNIQUE INDEX "SaleReview_settlementId_authorId_key" ON "SaleReview"("settlementId","authorId");
CREATE INDEX "SaleReview_recipientId_status_createdAt_id_idx" ON "SaleReview"("recipientId","status","createdAt","id");
CREATE TABLE "ReviewAppeal" (
 "id" TEXT PRIMARY KEY, "reviewId" TEXT NOT NULL REFERENCES "SaleReview"("id") ON UPDATE CASCADE,
 "reporterId" TEXT NOT NULL REFERENCES "User"("id") ON UPDATE CASCADE,
 "note" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'OPEN', "decision" TEXT,
 "decisionNote" TEXT, "reviewedBy" TEXT, "reviewedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ReviewAppeal_reviewId_key" ON "ReviewAppeal"("reviewId");
CREATE INDEX "ReviewAppeal_status_createdAt_id_idx" ON "ReviewAppeal"("status","createdAt","id");
