-- CreateEnum
CREATE TYPE "AIOperationType" AS ENUM ('TRANSACTION_EXTRACTION', 'AUDIO_TRANSCRIPTION', 'IMAGE_ANALYSIS', 'CATEGORY_SUGGESTION');

-- CreateEnum
CREATE TYPE "AIInputType" AS ENUM ('TEXT', 'AUDIO', 'IMAGE');

-- CreateTable
CREATE TABLE "ai_usage_logs" (
    "id" TEXT NOT NULL,
    "userCacheId" TEXT,
    "phoneNumber" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "operation" "AIOperationType" NOT NULL,
    "inputType" "AIInputType" NOT NULL,
    "inputText" TEXT,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "totalTokens" INTEGER NOT NULL,
    "estimatedCost" DECIMAL(10,6) NOT NULL,
    "responseTime" INTEGER,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_usage_logs_userCacheId_idx" ON "ai_usage_logs"("userCacheId");

-- CreateIndex
CREATE INDEX "ai_usage_logs_phoneNumber_idx" ON "ai_usage_logs"("phoneNumber");

-- CreateIndex
CREATE INDEX "ai_usage_logs_provider_idx" ON "ai_usage_logs"("provider");

-- CreateIndex
CREATE INDEX "ai_usage_logs_operation_idx" ON "ai_usage_logs"("operation");

-- CreateIndex
CREATE INDEX "ai_usage_logs_createdAt_idx" ON "ai_usage_logs"("createdAt");
