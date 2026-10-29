-- CreateTable
CREATE TABLE "LocalProxyRoom" (
    "auctionId" TEXT NOT NULL,
    "creatorUserId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocalProxyRoom_pkey" PRIMARY KEY ("auctionId")
);

-- CreateTable
CREATE TABLE "LocalProxyMember" (
    "auctionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,

    CONSTRAINT "LocalProxyMember_pkey" PRIMARY KEY ("auctionId","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "LocalProxyRoom_creatorUserId_requestId_key" ON "LocalProxyRoom"("creatorUserId", "requestId");

-- CreateIndex
CREATE INDEX "LocalProxyMember_userId_idx" ON "LocalProxyMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LocalProxyMember_auctionId_actorId_key" ON "LocalProxyMember"("auctionId", "actorId");

-- AddForeignKey
ALTER TABLE "LocalProxyRoom" ADD CONSTRAINT "LocalProxyRoom_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "LocalProxyAuction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalProxyMember" ADD CONSTRAINT "LocalProxyMember_auctionId_fkey" FOREIGN KEY ("auctionId") REFERENCES "LocalProxyRoom"("auctionId") ON DELETE CASCADE ON UPDATE CASCADE;
