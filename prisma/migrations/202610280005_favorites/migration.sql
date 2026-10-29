CREATE TABLE "Favorite" (
 "userId" TEXT NOT NULL,
 "vehicleId" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "Favorite_pkey" PRIMARY KEY ("userId","vehicleId"),
 CONSTRAINT "Favorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "Favorite_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Favorite_userId_createdAt_idx" ON "Favorite"("userId","createdAt");
