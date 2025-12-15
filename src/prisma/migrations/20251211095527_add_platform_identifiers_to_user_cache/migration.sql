/*
  Warnings:

  - A unique constraint covering the columns `[whatsappId]` on the table `user_cache` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[telegramId]` on the table `user_cache` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "user_cache" ADD COLUMN     "telegramId" TEXT,
ADD COLUMN     "whatsappId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "user_cache_whatsappId_key" ON "user_cache"("whatsappId");

-- CreateIndex
CREATE UNIQUE INDEX "user_cache_telegramId_key" ON "user_cache"("telegramId");

-- CreateIndex
CREATE INDEX "user_cache_whatsappId_idx" ON "user_cache"("whatsappId");

-- CreateIndex
CREATE INDEX "user_cache_telegramId_idx" ON "user_cache"("telegramId");
