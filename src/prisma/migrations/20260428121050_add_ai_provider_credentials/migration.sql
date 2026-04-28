-- DropIndex
DROP INDEX "user_synonyms_userId_keyword_idx";

-- CreateTable
CREATE TABLE "ai_provider_credentials" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isExhausted" BOOLEAN NOT NULL DEFAULT false,
    "exhaustedAt" TIMESTAMP(3),
    "exhaustedReason" VARCHAR(255),
    "lastUsedAt" TIMESTAMP(3),
    "totalRequests" INTEGER NOT NULL DEFAULT 0,
    "totalErrors" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_provider_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_provider_credentials_provider_isActive_isExhausted_prior_idx" ON "ai_provider_credentials"("provider", "isActive", "isExhausted", "priority");

-- CreateIndex
CREATE INDEX "ai_provider_credentials_lastUsedAt_idx" ON "ai_provider_credentials"("lastUsedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_provider_credentials_provider_label_key" ON "ai_provider_credentials"("provider", "label");

-- CreateIndex
CREATE INDEX "ai_usage_logs_gastoCertoId_idx" ON "ai_usage_logs"("gastoCertoId");

-- CreateIndex
CREATE INDEX "ai_usage_logs_platform_idx" ON "ai_usage_logs"("platform");

-- CreateIndex
CREATE INDEX "transaction_confirmations_phoneNumber_status_expiresAt_idx" ON "transaction_confirmations"("phoneNumber", "status", "expiresAt");

-- AddForeignKey
ALTER TABLE "user_synonyms" ADD CONSTRAINT "user_synonyms_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user_cache"("gastoCertoId") ON DELETE CASCADE ON UPDATE CASCADE;
