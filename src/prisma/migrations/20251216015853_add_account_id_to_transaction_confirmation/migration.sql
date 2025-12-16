-- AlterTable
ALTER TABLE "transaction_confirmations" ADD COLUMN     "accountId" TEXT;

-- CreateIndex
CREATE INDEX "transaction_confirmations_accountId_idx" ON "transaction_confirmations"("accountId");
