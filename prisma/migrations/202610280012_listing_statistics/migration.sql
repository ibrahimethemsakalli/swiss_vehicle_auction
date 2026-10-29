CREATE TABLE "ListingViewDay" (
  "id" TEXT NOT NULL,
  "vehicleId" TEXT NOT NULL,
  "day" DATE NOT NULL,
  "viewerToken" TEXT NOT NULL,
  CONSTRAINT "ListingViewDay_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ListingViewDay_vehicleId_day_viewerToken_key" ON "ListingViewDay"("vehicleId", "day", "viewerToken");
CREATE INDEX "ListingViewDay_day_viewerToken_idx" ON "ListingViewDay"("day", "viewerToken");
ALTER TABLE "ListingViewDay" ADD CONSTRAINT "ListingViewDay_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
