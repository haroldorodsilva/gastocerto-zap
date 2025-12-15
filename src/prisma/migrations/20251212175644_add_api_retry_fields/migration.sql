-- AlterTable
ALTER TABLE "transaction_confirmations" ADD COLUMN     "apiError" TEXT,
ADD COLUMN     "apiRetryCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "apiSent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "apiSentAt" TIMESTAMP(3),
ADD COLUMN     "apiTransactionId" TEXT;

-- CreateIndex
CREATE INDEX "transaction_confirmations_apiSent_idx" ON "transaction_confirmations"("apiSent");

-- CreateIndex
CREATE INDEX "transaction_confirmations_status_apiSent_idx" ON "transaction_confirmations"("status", "apiSent");
