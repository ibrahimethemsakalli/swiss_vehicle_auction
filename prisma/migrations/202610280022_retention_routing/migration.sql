ALTER TABLE "Notification" ADD COLUMN "retentionRequestId" TEXT REFERENCES "RetentionReviewRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Notification_retentionRequestId_idx" ON "Notification"("retentionRequestId");
