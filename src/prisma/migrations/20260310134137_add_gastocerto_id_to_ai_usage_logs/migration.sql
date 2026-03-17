-- AlterTable: sync all missing columns on ai_usage_logs
ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "gastoCertoId" TEXT;
ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "platform" TEXT;
ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "ragSearchLogId" TEXT;
ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "ragInitialFound" BOOLEAN;
ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "ragInitialScore" DECIMAL(5,4);
ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "ragInitialCategory" TEXT;
ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "aiCategoryId" TEXT;
ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "aiCategoryName" TEXT;
ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "aiConfidence" DECIMAL(5,4);
ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "finalCategoryId" TEXT;
ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "finalCategoryName" TEXT;
ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "wasRagFallback" BOOLEAN DEFAULT false;
ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "needsSynonymLearning" BOOLEAN DEFAULT false;
ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "userCacheId" TEXT;
ALTER TABLE "ai_usage_logs" ADD COLUMN IF NOT EXISTS "responseTime" INTEGER;
