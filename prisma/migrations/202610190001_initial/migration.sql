-- CreateEnum
CREATE TYPE "Role" AS ENUM ('PRIVATE_USER', 'DEALER', 'ADMIN');

-- CreateEnum
CREATE TYPE "ListingType" AS ENUM ('AUCTION_7_DAYS', 'FIXED_PRICE_OFFERS');

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('DRAFT', 'PENDING_VERIFICATION', 'ACTIVE', 'SOLD', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BidStatus" AS ENUM ('ACTIVE', 'OUTBID', 'WON', 'DEFAULTED_PENALIZED', 'RELEASED');

-- CreateEnum
CREATE TYPE "HoldStatus" AS ENUM ('AUTHORIZED', 'RELEASE_PENDING', 'RELEASED', 'CAPTURE_PENDING', 'CAPTURED_FEE', 'CAPTURED_COMPENSATION', 'EXPIRED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'PRIVATE_USER',
    "language" TEXT NOT NULL DEFAULT 'de',
    "isIdentityVerified" BOOLEAN NOT NULL DEFAULT false,
    "phoneVerifiedAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "swissId" TEXT,
    "canton" TEXT,
    "companyName" TEXT,
    "handelsregisterNr" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stammnummer" TEXT NOT NULL,
    "vinChassis" TEXT NOT NULL,
    "firstRegistration" TIMESTAMP(3) NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "cubicCapacity" INTEGER,
    "powerKw" INTEGER,
    "mileage" INTEGER NOT NULL,
    "canton" TEXT NOT NULL,
    "mfkDate" TIMESTAMP(3) NOT NULL,
    "serviceHistory" TEXT NOT NULL,
    "tireCondition" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "images" TEXT[],
    "listingType" "ListingType" NOT NULL,
    "status" "VehicleStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "isVerifiedPrivate" BOOLEAN NOT NULL DEFAULT false,
    "startPrice" DECIMAL(12,2) NOT NULL,
    "reservePrice" DECIMAL(12,2),
    "buyNowPrice" DECIMAL(12,2),
    "minimumIncrement" DECIMAL(12,2) NOT NULL DEFAULT 100,
    "currentPrice" DECIMAL(12,2),
    "auctionStartAt" TIMESTAMP(3),
    "auctionEndsAt" TIMESTAMP(3),
    "antiSnipingCount" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bid" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "holdId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "status" "BidStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentHold" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "gateway" TEXT NOT NULL,
    "gatewayTransactionId" TEXT NOT NULL,
    "amount" DECIMAL(5,2) NOT NULL DEFAULT 30,
    "currency" TEXT NOT NULL DEFAULT 'CHF',
    "status" "HoldStatus" NOT NULL DEFAULT 'AUTHORIZED',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "holdId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "gatewayTransactionId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuctionLog" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "extensionSeconds" INTEGER NOT NULL DEFAULT 120,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuctionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "User_swissId_key" ON "User"("swissId");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_vinChassis_key" ON "Vehicle"("vinChassis");

-- CreateIndex
CREATE INDEX "Vehicle_status_canton_auctionEndsAt_idx" ON "Vehicle"("status", "canton", "auctionEndsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Bid_holdId_key" ON "Bid"("holdId");

-- CreateIndex
CREATE INDEX "Bid_vehicleId_status_idx" ON "Bid"("vehicleId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Bid_userId_requestId_key" ON "Bid"("userId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentHold_gatewayTransactionId_key" ON "PaymentHold"("gatewayTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_gatewayTransactionId_key" ON "Transaction"("gatewayTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_idempotencyKey_key" ON "Transaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "OutboxEvent_deliveredAt_createdAt_idx" ON "OutboxEvent"("deliveredAt", "createdAt");

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bid" ADD CONSTRAINT "Bid_holdId_fkey" FOREIGN KEY ("holdId") REFERENCES "PaymentHold"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentHold" ADD CONSTRAINT "PaymentHold_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentHold" ADD CONSTRAINT "PaymentHold_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_holdId_fkey" FOREIGN KEY ("holdId") REFERENCES "PaymentHold"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuctionLog" ADD CONSTRAINT "AuctionLog_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
