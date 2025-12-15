/*
  Warnings:

  - A unique constraint covering the columns `[phoneNumber]` on the table `user_cache` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "user_cache_telegramId_key";

-- DropIndex
DROP INDEX "user_cache_whatsappId_key";

-- CreateIndex
CREATE UNIQUE INDEX "user_cache_phoneNumber_key" ON "user_cache"("phoneNumber");
