-- AlterTable
ALTER TABLE "rag_search_logs" ALTER COLUMN "bestScore" SET DATA TYPE DECIMAL(6,4);

-- AlterTable
ALTER TABLE "transaction_confirmations" ADD COLUMN     "creditCardId" TEXT,
ADD COLUMN     "fixedFrequency" TEXT,
ADD COLUMN     "installmentNumber" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "installments" INTEGER,
ADD COLUMN     "invoiceMonth" TEXT,
ADD COLUMN     "isFixed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "paymentStatus" TEXT NOT NULL DEFAULT 'DONE';

-- AlterTable
ALTER TABLE "user_cache" ADD COLUMN     "defaultCreditCardId" TEXT;

-- AlterTable
ALTER TABLE "whatsapp_sessions" ADD COLUMN     "lastConnected" TIMESTAMP(3);
