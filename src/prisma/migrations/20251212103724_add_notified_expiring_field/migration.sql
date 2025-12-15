-- AlterTable
ALTER TABLE "transaction_confirmations" ADD COLUMN     "notifiedExpiring" BOOLEAN NOT NULL DEFAULT false;
