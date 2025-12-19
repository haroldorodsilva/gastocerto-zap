-- CreateEnum
CREATE TYPE "SynonymSource" AS ENUM ('USER_CONFIRMED', 'AI_SUGGESTED', 'AUTO_LEARNED', 'IMPORTED');

-- CreateTable
CREATE TABLE "user_synonyms" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "synonyms" TEXT[],
    "categoryId" TEXT,
    "categoryName" TEXT,
    "source" "SynonymSource" NOT NULL DEFAULT 'USER_CONFIRMED',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_synonyms_pkey" PRIMARY KEY ("id")
);

-- AlterTable: RAG Search Logs - Add tracking fields
ALTER TABLE "rag_search_logs" ADD COLUMN "flowStep" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "rag_search_logs" ADD COLUMN "totalSteps" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "rag_search_logs" ADD COLUMN "aiProvider" TEXT;
ALTER TABLE "rag_search_logs" ADD COLUMN "aiModel" TEXT;
ALTER TABLE "rag_search_logs" ADD COLUMN "aiConfidence" DECIMAL(5,4);
ALTER TABLE "rag_search_logs" ADD COLUMN "aiCategoryId" TEXT;
ALTER TABLE "rag_search_logs" ADD COLUMN "aiCategoryName" TEXT;
ALTER TABLE "rag_search_logs" ADD COLUMN "finalCategoryId" TEXT;
ALTER TABLE "rag_search_logs" ADD COLUMN "finalCategoryName" TEXT;
ALTER TABLE "rag_search_logs" ADD COLUMN "ragInitialScore" DECIMAL(5,4);
ALTER TABLE "rag_search_logs" ADD COLUMN "ragFinalScore" DECIMAL(5,4);
ALTER TABLE "rag_search_logs" ADD COLUMN "wasAiFallback" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: AI Usage Logs - Add RAG context fields
ALTER TABLE "ai_usage_logs" ADD COLUMN "ragSearchLogId" TEXT;
ALTER TABLE "ai_usage_logs" ADD COLUMN "ragInitialFound" BOOLEAN;
ALTER TABLE "ai_usage_logs" ADD COLUMN "ragInitialScore" DECIMAL(5,4);
ALTER TABLE "ai_usage_logs" ADD COLUMN "ragInitialCategory" TEXT;
ALTER TABLE "ai_usage_logs" ADD COLUMN "aiCategoryId" TEXT;
ALTER TABLE "ai_usage_logs" ADD COLUMN "aiCategoryName" TEXT;
ALTER TABLE "ai_usage_logs" ADD COLUMN "aiConfidence" DECIMAL(5,4);
ALTER TABLE "ai_usage_logs" ADD COLUMN "finalCategoryId" TEXT;
ALTER TABLE "ai_usage_logs" ADD COLUMN "finalCategoryName" TEXT;
ALTER TABLE "ai_usage_logs" ADD COLUMN "wasRagFallback" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ai_usage_logs" ADD COLUMN "needsSynonymLearning" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "user_synonyms_userId_idx" ON "user_synonyms"("userId");

-- CreateIndex
CREATE INDEX "user_synonyms_usageCount_idx" ON "user_synonyms"("usageCount");

-- CreateIndex
CREATE INDEX "user_synonyms_userId_keyword_idx" ON "user_synonyms"("userId", "keyword");

-- CreateIndex
CREATE UNIQUE INDEX "user_synonyms_userId_keyword_key" ON "user_synonyms"("userId", "keyword");

-- CreateIndex
CREATE INDEX "rag_search_logs_flowStep_idx" ON "rag_search_logs"("flowStep");

-- CreateIndex
CREATE INDEX "rag_search_logs_aiProvider_idx" ON "rag_search_logs"("aiProvider");

-- CreateIndex
CREATE INDEX "rag_search_logs_wasAiFallback_idx" ON "rag_search_logs"("wasAiFallback");

-- CreateIndex
CREATE INDEX "ai_usage_logs_ragSearchLogId_idx" ON "ai_usage_logs"("ragSearchLogId");

-- CreateIndex
CREATE INDEX "ai_usage_logs_wasRagFallback_idx" ON "ai_usage_logs"("wasRagFallback");

-- CreateIndex
CREATE INDEX "ai_usage_logs_needsSynonymLearning_idx" ON "ai_usage_logs"("needsSynonymLearning");

-- AddForeignKey (if needed)
-- Note: user_synonyms doesn't have FK to users by design (for flexibility)
-- Note: ai_usage_logs.ragSearchLogId doesn't have FK (optional reference)
