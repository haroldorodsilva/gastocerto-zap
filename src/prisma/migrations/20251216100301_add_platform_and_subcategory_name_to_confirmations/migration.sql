-- AlterTable
ALTER TABLE "transaction_confirmations" ADD COLUMN     "platform" TEXT NOT NULL DEFAULT 'whatsapp',
ADD COLUMN     "subCategoryName" TEXT;

-- CreateIndex
CREATE INDEX "transaction_confirmations_platform_idx" ON "transaction_confirmations"("platform");
