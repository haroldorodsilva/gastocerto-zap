/*
  Warnings:

  - You are about to drop the column `token` on the `sessions` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "sessions" DROP COLUMN "token";

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

-- CreateIndex
CREATE UNIQUE INDEX "telegram_sessions_sessionId_key" ON "telegram_sessions"("sessionId");

-- CreateIndex
CREATE INDEX "telegram_sessions_status_idx" ON "telegram_sessions"("status");
