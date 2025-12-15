-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('INACTIVE', 'CONNECTING', 'QR_PENDING', 'CONNECTED', 'DISCONNECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "OnboardingStep" AS ENUM ('COLLECT_NAME', 'COLLECT_EMAIL', 'CONFIRM_DATA', 'CREATING_ACCOUNT', 'COMPLETED');

-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('EXPENSES', 'INCOME');

-- CreateEnum
CREATE TYPE "ConfirmationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "sessions" (
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

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_sessions" (
    "id" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
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
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hasActiveSubscription" BOOLEAN NOT NULL DEFAULT false,
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
    "messageId" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "category" TEXT NOT NULL,
    "description" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "extractedData" JSONB NOT NULL,
    "status" "ConfirmationStatus" NOT NULL DEFAULT 'PENDING',
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transaction_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sessions_sessionId_key" ON "sessions"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_phoneNumber_key" ON "sessions"("phoneNumber");

-- CreateIndex
CREATE INDEX "sessions_phoneNumber_idx" ON "sessions"("phoneNumber");

-- CreateIndex
CREATE INDEX "sessions_status_idx" ON "sessions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_sessions_phoneNumber_key" ON "onboarding_sessions"("phoneNumber");

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
CREATE UNIQUE INDEX "transaction_confirmations_messageId_key" ON "transaction_confirmations"("messageId");

-- CreateIndex
CREATE INDEX "transaction_confirmations_phoneNumber_idx" ON "transaction_confirmations"("phoneNumber");

-- CreateIndex
CREATE INDEX "transaction_confirmations_status_idx" ON "transaction_confirmations"("status");

-- CreateIndex
CREATE INDEX "transaction_confirmations_expiresAt_idx" ON "transaction_confirmations"("expiresAt");

-- CreateIndex
CREATE INDEX "audit_logs_phoneNumber_idx" ON "audit_logs"("phoneNumber");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");
