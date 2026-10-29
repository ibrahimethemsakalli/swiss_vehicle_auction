-- CreateEnum
CREATE TYPE "LocalProxyHoldStatus" AS ENUM ('AUTHORIZED', 'RELEASED');

-- CreateTable
CREATE TABLE "LocalProxyAuction" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "buyerIds" TEXT[],
    "startCents" BIGINT NOT NULL,
    "incrementCents" BIGINT NOT NULL,
    "priceCents" BIGINT,
    "leaderId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LocalProxyAuction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocalProxyHold" (
    "id" TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL DEFAULT 3000,
    "currency" TEXT NOT NULL DEFAULT 'CHF',
    "gateway" TEXT NOT NULL DEFAULT 'local-proxy',
    "status" "LocalProxyHoldStatus" NOT NULL DEFAULT 'AUTHORIZED',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "LocalProxyHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocalProxyLimit" (
    "auctionId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "maximumCents" BIGINT NOT NULL,
    "holdId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocalProxyLimit_pkey" PRIMARY KEY ("auctionId","ownerId")
);

-- CreateTable
CREATE TABLE "LocalProxyCommand" (
    "auctionId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocalProxyCommand_pkey" PRIMARY KEY ("auctionId","ownerId","requestId")
);

-- CreateTable
CREATE TABLE "LocalProxyEvent" (
    "id" TEXT NOT NULL,
    "auctionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocalProxyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LocalProxyHold_auctionId_ownerId_idx" ON "LocalProxyHold"("auctionId", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "LocalProxyLimit_holdId_key" ON "LocalProxyLimit"("holdId");

-- CreateIndex
CREATE UNIQUE INDEX "LocalProxyEvent_auctionId_version_key" ON "LocalProxyEvent"("auctionId", "version");

-- AddForeignKey
ALTER TABLE "LocalProxyHold" ADD CONSTRAINT "LocalProxyHold_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "LocalProxyAuction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalProxyLimit" ADD CONSTRAINT "LocalProxyLimit_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "LocalProxyAuction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalProxyLimit" ADD CONSTRAINT "LocalProxyLimit_holdId_fkey" FOREIGN KEY ("holdId") REFERENCES "LocalProxyHold"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalProxyCommand" ADD CONSTRAINT "LocalProxyCommand_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "LocalProxyAuction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalProxyEvent" ADD CONSTRAINT "LocalProxyEvent_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "LocalProxyAuction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
