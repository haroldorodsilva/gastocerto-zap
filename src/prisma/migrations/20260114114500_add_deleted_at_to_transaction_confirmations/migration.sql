-- AlterTable
ALTER TABLE "transaction_confirmations" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "transaction_confirmations_deletedAt_idx" ON "transaction_confirmations"("deletedAt");
