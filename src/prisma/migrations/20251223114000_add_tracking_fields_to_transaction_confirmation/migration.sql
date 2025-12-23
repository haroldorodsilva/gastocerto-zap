-- AlterTable
ALTER TABLE "transaction_confirmations" 
ADD COLUMN IF NOT EXISTS "aiUsageLogId" TEXT,
ADD COLUMN IF NOT EXISTS "ragSearchLogId" TEXT;

-- Comment
COMMENT ON COLUMN "transaction_confirmations"."aiUsageLogId" IS 'ID do log de uso da IA (para tracking e análise)';
COMMENT ON COLUMN "transaction_confirmations"."ragSearchLogId" IS 'ID do log de busca RAG (para tracking e análise)';
