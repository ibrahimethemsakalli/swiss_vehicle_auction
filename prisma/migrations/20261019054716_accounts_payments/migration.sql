-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


BEGIN;
ALTER TYPE "HoldStatus" ADD VALUE 'PENDING_AUTHORIZATION';
ALTER TYPE "HoldStatus" ADD VALUE 'FAILED';
ALTER TYPE "HoldStatus" ADD VALUE 'CAPTURED_UNEXPECTED';
COMMIT;

-- AlterTable
ALTER TABLE "PaymentHold" ADD COLUMN     "replacementBidId" TEXT,
ALTER COLUMN "gatewayTransactionId" DROP NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'PENDING_AUTHORIZATION';

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedAt" TIMESTAMP(3),
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "SmsVerification" (
    "userId" TEXT NOT NULL,
    "verificationSid" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SmsVerification_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

