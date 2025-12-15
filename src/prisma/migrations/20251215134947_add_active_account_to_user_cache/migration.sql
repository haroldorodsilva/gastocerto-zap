-- AlterTable
ALTER TABLE "user_cache" ADD COLUMN     "accounts" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "activeAccountId" TEXT;

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

-- CreateIndex
CREATE INDEX "rag_search_logs_userId_idx" ON "rag_search_logs"("userId");

-- CreateIndex
CREATE INDEX "rag_search_logs_success_idx" ON "rag_search_logs"("success");

-- CreateIndex
CREATE INDEX "rag_search_logs_createdAt_idx" ON "rag_search_logs"("createdAt");

-- CreateIndex
CREATE INDEX "rag_search_logs_userId_success_idx" ON "rag_search_logs"("userId", "success");

-- CreateIndex
CREATE INDEX "user_cache_activeAccountId_idx" ON "user_cache"("activeAccountId");
