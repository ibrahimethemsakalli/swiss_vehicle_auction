CREATE TABLE "DealerProfile" (
 "userId" TEXT NOT NULL, "name" TEXT NOT NULL, "canton" TEXT NOT NULL,
 "city" TEXT NOT NULL, "postalCode" TEXT NOT NULL, "description" TEXT NOT NULL,
 "published" BOOLEAN NOT NULL DEFAULT false, "version" INTEGER NOT NULL DEFAULT 1,
 "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "DealerProfile_pkey" PRIMARY KEY ("userId")
);
ALTER TABLE "DealerProfile" ADD CONSTRAINT "DealerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "DealerImport" (
 "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "requestId" TEXT NOT NULL,
 "contentHash" TEXT NOT NULL, "draftIds" TEXT[] NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "DealerImport_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DealerImport_userId_requestId_key" ON "DealerImport"("userId", "requestId");
ALTER TABLE "DealerImport" ADD CONSTRAINT "DealerImport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
