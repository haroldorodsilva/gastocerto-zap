-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AIOperationType" ADD VALUE 'RAG_EMBEDDING';
ALTER TYPE "AIOperationType" ADD VALUE 'INTENT_DETECTION';

-- AlterTable
ALTER TABLE "ai_settings" ADD COLUMN     "ragAiEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ragAiProvider" TEXT NOT NULL DEFAULT 'groq',
ALTER COLUMN "ragProvider" SET DEFAULT 'bm25';
