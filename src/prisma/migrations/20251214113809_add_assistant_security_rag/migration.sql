-- CreateEnum
CREATE TYPE "SecuritySeverity" AS ENUM ('low', 'medium', 'high');

-- AlterTable
ALTER TABLE "ai_settings" ADD COLUMN     "assistantEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "assistantMaxHistoryMsgs" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "assistantPersonality" TEXT NOT NULL DEFAULT 'friendly',
ADD COLUMN     "ragAutoApply" DOUBLE PRECISION NOT NULL DEFAULT 0.88,
ADD COLUMN     "ragCacheEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "ragEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ragProvider" TEXT NOT NULL DEFAULT 'local',
ADD COLUMN     "ragThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.75,
ADD COLUMN     "securityEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "securityLogEvents" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "securityMaxMessageLength" INTEGER NOT NULL DEFAULT 500,
ADD COLUMN     "securityRateLimitHour" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "securityRateLimitMinute" INTEGER NOT NULL DEFAULT 20;

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
CREATE INDEX "security_logs_userId_createdAt_idx" ON "security_logs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "security_logs_eventType_createdAt_idx" ON "security_logs"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "security_logs_severity_createdAt_idx" ON "security_logs"("severity", "createdAt");
