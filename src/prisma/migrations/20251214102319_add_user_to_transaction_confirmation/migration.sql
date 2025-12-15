-- AlterTable
ALTER TABLE "transaction_confirmations" ADD COLUMN     "userId" TEXT;

-- CreateIndex
CREATE INDEX "transaction_confirmations_userId_idx" ON "transaction_confirmations"("userId");

-- AddForeignKey
ALTER TABLE "transaction_confirmations" ADD CONSTRAINT "transaction_confirmations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user_cache"("id") ON DELETE SET NULL ON UPDATE CASCADE;
