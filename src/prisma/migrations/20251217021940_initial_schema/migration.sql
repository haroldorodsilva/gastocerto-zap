-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('INACTIVE', 'CONNECTING', 'QR_PENDING', 'CONNECTED', 'DISCONNECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "OnboardingStep" AS ENUM ('COLLECT_NAME', 'COLLECT_EMAIL', 'REQUEST_PHONE', 'CHECK_EXISTING_USER', 'REQUEST_VERIFICATION_CODE', 'VERIFY_CODE', 'CHOOSE_ACCOUNT', 'CONFIRM_DATA', 'CREATING_ACCOUNT', 'COMPLETED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('EXPENSES', 'INCOME');

-- CreateEnum
CREATE TYPE "ConfirmationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "AIOperationType" AS ENUM ('TRANSACTION_EXTRACTION', 'AUDIO_TRANSCRIPTION', 'IMAGE_ANALYSIS', 'CATEGORY_SUGGESTION', 'RAG_EMBEDDING', 'INTENT_DETECTION');

-- CreateEnum
CREATE TYPE "AIInputType" AS ENUM ('TEXT', 'AUDIO', 'IMAGE');

-- CreateEnum
CREATE TYPE "SecuritySeverity" AS ENUM ('low', 'medium', 'high');

-- CreateTable
CREATE TABLE "whatsapp_sessions" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "name" TEXT,
    "status" "SessionStatus" NOT NULL DEFAULT 'INACTIVE',
    "creds" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeen" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_sessions" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'INACTIVE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeen" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_sessions" (
    "id" TEXT NOT NULL,
    "platformId" TEXT NOT NULL,
    "phoneNumber" TEXT,
    "currentStep" "OnboardingStep" NOT NULL DEFAULT 'COLLECT_NAME',
    "data" JSONB NOT NULL DEFAULT '{}',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "onboarding_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_cache" (
    "id" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "gastoCertoId" TEXT NOT NULL,
    "whatsappId" TEXT,
    "telegramId" TEXT,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hasActiveSubscription" BOOLEAN NOT NULL DEFAULT false,
    "activeAccountId" TEXT,
    "accounts" JSONB NOT NULL DEFAULT '[]',
    "categories" JSONB NOT NULL DEFAULT '[]',
    "preferences" JSONB,
    "lastSyncAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_confirmations" (
    "id" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "platform" TEXT NOT NULL DEFAULT 'whatsapp',
    "userId" TEXT,
    "accountId" TEXT,
    "messageId" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "category" TEXT NOT NULL,
    "categoryId" TEXT,
    "subCategoryId" TEXT,
    "subCategoryName" TEXT,
    "description" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "extractedData" JSONB NOT NULL,
    "status" "ConfirmationStatus" NOT NULL DEFAULT 'PENDING',
    "confirmedAt" TIMESTAMP(3),
    "notifiedExpiring" BOOLEAN NOT NULL DEFAULT false,
    "apiSent" BOOLEAN NOT NULL DEFAULT false,
    "apiSentAt" TIMESTAMP(3),
    "apiError" TEXT,
    "apiRetryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transaction_confirmations_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "rag_search_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "queryNormalized" TEXT NOT NULL,
    "matches" JSONB NOT NULL,
    "bestMatch" TEXT,
    "bestScore" DECIMAL(5,4),
    "threshold" DECIMAL(5,4) NOT NULL,
    "success" BOOLEAN NOT NULL,
    "ragMode" TEXT NOT NULL DEFAULT 'BM25',
    "responseTime" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rag_search_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unrecognized_messages" (
    "id" TEXT NOT NULL,
    "userCacheId" TEXT,
    "phoneNumber" TEXT NOT NULL,
    "messageText" TEXT NOT NULL,
    "detectedIntent" TEXT,
    "confidence" DOUBLE PRECISION,
    "wasProcessed" BOOLEAN NOT NULL DEFAULT false,
    "addedToContext" BOOLEAN NOT NULL DEFAULT false,
    "userFeedback" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unrecognized_messages_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "ai_settings" (
    "id" TEXT NOT NULL,
    "textProvider" TEXT NOT NULL DEFAULT 'openai',
    "imageProvider" TEXT NOT NULL DEFAULT 'google_gemini',
    "audioProvider" TEXT NOT NULL DEFAULT 'groq',
    "categoryProvider" TEXT NOT NULL DEFAULT 'groq',
    "primaryProvider" TEXT NOT NULL DEFAULT 'groq',
    "fallbackEnabled" BOOLEAN NOT NULL DEFAULT true,
    "fallbackTextChain" TEXT[] DEFAULT ARRAY['groq', 'deepseek', 'google_gemini', 'openai']::TEXT[],
    "fallbackImageChain" TEXT[] DEFAULT ARRAY['google_gemini', 'openai']::TEXT[],
    "fallbackAudioChain" TEXT[] DEFAULT ARRAY['openai', 'groq']::TEXT[],
    "fallbackCategoryChain" TEXT[] DEFAULT ARRAY['groq', 'deepseek', 'google_gemini', 'openai']::TEXT[],
    "cacheEnabled" BOOLEAN NOT NULL DEFAULT false,
    "cacheTTL" INTEGER NOT NULL DEFAULT 3600,
    "rateLimitEnabled" BOOLEAN NOT NULL DEFAULT true,
    "ragEnabled" BOOLEAN NOT NULL DEFAULT false,
    "ragAiEnabled" BOOLEAN NOT NULL DEFAULT false,
    "ragAiProvider" TEXT NOT NULL DEFAULT 'groq',
    "ragProvider" TEXT NOT NULL DEFAULT 'bm25',
    "ragThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.6,
    "ragCacheEnabled" BOOLEAN NOT NULL DEFAULT true,
    "assistantEnabled" BOOLEAN NOT NULL DEFAULT true,
    "assistantPersonality" TEXT NOT NULL DEFAULT 'friendly',
    "assistantMaxHistoryMsgs" INTEGER NOT NULL DEFAULT 5,
    "auto_register_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.90,
    "min_confidence_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.50,
    "securityEnabled" BOOLEAN NOT NULL DEFAULT true,
    "securityMaxMessageLength" INTEGER NOT NULL DEFAULT 500,
    "securityRateLimitMinute" INTEGER NOT NULL DEFAULT 20,
    "securityRateLimitHour" INTEGER NOT NULL DEFAULT 100,
    "securityLogEvents" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "details" VARCHAR(500) NOT NULL,
    "severity" "SecuritySeverity" NOT NULL DEFAULT 'low',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_sessions_sessionId_key" ON "whatsapp_sessions"("sessionId");

-- CreateIndex
CREATE INDEX "whatsapp_sessions_phoneNumber_idx" ON "whatsapp_sessions"("phoneNumber");

-- CreateIndex
CREATE INDEX "whatsapp_sessions_status_idx" ON "whatsapp_sessions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_sessions_sessionId_key" ON "telegram_sessions"("sessionId");

-- CreateIndex
CREATE INDEX "telegram_sessions_status_idx" ON "telegram_sessions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_sessions_platformId_key" ON "onboarding_sessions"("platformId");

-- CreateIndex
CREATE INDEX "onboarding_sessions_platformId_idx" ON "onboarding_sessions"("platformId");

-- CreateIndex
CREATE INDEX "onboarding_sessions_phoneNumber_idx" ON "onboarding_sessions"("phoneNumber");

-- CreateIndex
CREATE INDEX "onboarding_sessions_expiresAt_idx" ON "onboarding_sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "user_cache_phoneNumber_key" ON "user_cache"("phoneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "user_cache_gastoCertoId_key" ON "user_cache"("gastoCertoId");

-- CreateIndex
CREATE INDEX "user_cache_phoneNumber_idx" ON "user_cache"("phoneNumber");

-- CreateIndex
CREATE INDEX "user_cache_gastoCertoId_idx" ON "user_cache"("gastoCertoId");

-- CreateIndex
CREATE INDEX "user_cache_whatsappId_idx" ON "user_cache"("whatsappId");

-- CreateIndex
CREATE INDEX "user_cache_telegramId_idx" ON "user_cache"("telegramId");

-- CreateIndex
CREATE INDEX "user_cache_activeAccountId_idx" ON "user_cache"("activeAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "transaction_confirmations_messageId_key" ON "transaction_confirmations"("messageId");

-- CreateIndex
CREATE INDEX "transaction_confirmations_phoneNumber_idx" ON "transaction_confirmations"("phoneNumber");

-- CreateIndex
CREATE INDEX "transaction_confirmations_platform_idx" ON "transaction_confirmations"("platform");

-- CreateIndex
CREATE INDEX "transaction_confirmations_userId_idx" ON "transaction_confirmations"("userId");

-- CreateIndex
CREATE INDEX "transaction_confirmations_accountId_idx" ON "transaction_confirmations"("accountId");

-- CreateIndex
CREATE INDEX "transaction_confirmations_status_idx" ON "transaction_confirmations"("status");

-- CreateIndex
CREATE INDEX "transaction_confirmations_expiresAt_idx" ON "transaction_confirmations"("expiresAt");

-- CreateIndex
CREATE INDEX "transaction_confirmations_apiSent_idx" ON "transaction_confirmations"("apiSent");

-- CreateIndex
CREATE INDEX "transaction_confirmations_status_apiSent_idx" ON "transaction_confirmations"("status", "apiSent");

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

-- CreateIndex
CREATE INDEX "rag_search_logs_userId_idx" ON "rag_search_logs"("userId");

-- CreateIndex
CREATE INDEX "rag_search_logs_success_idx" ON "rag_search_logs"("success");

-- CreateIndex
CREATE INDEX "rag_search_logs_createdAt_idx" ON "rag_search_logs"("createdAt");

-- CreateIndex
CREATE INDEX "rag_search_logs_userId_success_idx" ON "rag_search_logs"("userId", "success");

-- CreateIndex
CREATE INDEX "unrecognized_messages_userCacheId_idx" ON "unrecognized_messages"("userCacheId");

-- CreateIndex
CREATE INDEX "unrecognized_messages_phoneNumber_idx" ON "unrecognized_messages"("phoneNumber");

-- CreateIndex
CREATE INDEX "unrecognized_messages_wasProcessed_idx" ON "unrecognized_messages"("wasProcessed");

-- CreateIndex
CREATE INDEX "unrecognized_messages_addedToContext_idx" ON "unrecognized_messages"("addedToContext");

-- CreateIndex
CREATE INDEX "unrecognized_messages_createdAt_idx" ON "unrecognized_messages"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_provider_configs_provider_key" ON "ai_provider_configs"("provider");

-- CreateIndex
CREATE INDEX "ai_provider_configs_provider_idx" ON "ai_provider_configs"("provider");

-- CreateIndex
CREATE INDEX "ai_provider_configs_enabled_idx" ON "ai_provider_configs"("enabled");

-- CreateIndex
CREATE INDEX "ai_provider_configs_priority_idx" ON "ai_provider_configs"("priority");

-- CreateIndex
CREATE INDEX "security_logs_userId_createdAt_idx" ON "security_logs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "security_logs_eventType_createdAt_idx" ON "security_logs"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "security_logs_severity_createdAt_idx" ON "security_logs"("severity", "createdAt");

-- AddForeignKey
ALTER TABLE "transaction_confirmations" ADD CONSTRAINT "transaction_confirmations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user_cache"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unrecognized_messages" ADD CONSTRAINT "unrecognized_messages_userCacheId_fkey" FOREIGN KEY ("userCacheId") REFERENCES "user_cache"("id") ON DELETE SET NULL ON UPDATE CASCADE;
