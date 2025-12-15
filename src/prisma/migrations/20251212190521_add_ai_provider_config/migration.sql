-- AlterTable
ALTER TABLE "whatsapp_sessions" RENAME CONSTRAINT "sessions_pkey" TO "whatsapp_sessions_pkey";

-- CreateTable
CREATE TABLE "ai_provider_configs" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "apiKey" TEXT,
    "baseUrl" TEXT,
    "textModel" TEXT,
    "visionModel" TEXT,
    "audioModel" TEXT,
    "rpmLimit" INTEGER DEFAULT 0,
    "tpmLimit" INTEGER DEFAULT 0,
    "inputCostPer1M" DECIMAL(10,6),
    "outputCostPer1M" DECIMAL(10,6),
    "cacheCostPer1M" DECIMAL(10,6),
    "supportsVision" BOOLEAN NOT NULL DEFAULT false,
    "supportsAudio" BOOLEAN NOT NULL DEFAULT false,
    "supportsCache" BOOLEAN NOT NULL DEFAULT false,
    "cacheEnabled" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 999,
    "fallbackEnabled" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB DEFAULT '{}',
    "lastUsedAt" TIMESTAMP(3),
    "totalRequests" INTEGER NOT NULL DEFAULT 0,
    "totalErrors" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_provider_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_provider_configs_provider_key" ON "ai_provider_configs"("provider");

-- CreateIndex
CREATE INDEX "ai_provider_configs_provider_idx" ON "ai_provider_configs"("provider");

-- CreateIndex
CREATE INDEX "ai_provider_configs_enabled_idx" ON "ai_provider_configs"("enabled");

-- CreateIndex
CREATE INDEX "ai_provider_configs_priority_idx" ON "ai_provider_configs"("priority");

-- RenameIndex
ALTER INDEX "sessions_phoneNumber_idx" RENAME TO "whatsapp_sessions_phoneNumber_idx";

-- RenameIndex
ALTER INDEX "sessions_sessionId_key" RENAME TO "whatsapp_sessions_sessionId_key";

-- RenameIndex
ALTER INDEX "sessions_status_idx" RENAME TO "whatsapp_sessions_status_idx";
