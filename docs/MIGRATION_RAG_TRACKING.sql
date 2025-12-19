-- Migration: add_rag_ai_tracking_fields
-- Adiciona campos de rastreamento completo do fluxo RAG → IA → RAG
-- Data: 19 de dezembro de 2025

-- ========================================
-- 1. Atualizar tabela rag_search_logs
-- ========================================

-- Adicionar campos de rastreamento do fluxo
ALTER TABLE "rag_search_logs" 
ADD COLUMN "flowStep" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "totalSteps" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "aiProvider" TEXT,
ADD COLUMN "aiModel" TEXT,
ADD COLUMN "aiConfidence" DECIMAL(5,4),
ADD COLUMN "aiCategoryId" TEXT,
ADD COLUMN "aiCategoryName" TEXT,
ADD COLUMN "finalCategoryId" TEXT,
ADD COLUMN "finalCategoryName" TEXT,
ADD COLUMN "ragInitialScore" DECIMAL(5,4),
ADD COLUMN "ragFinalScore" DECIMAL(5,4),
ADD COLUMN "wasAiFallback" BOOLEAN NOT NULL DEFAULT false;

-- Criar índices para otimizar queries de análise
CREATE INDEX "rag_search_logs_wasAiFallback_idx" ON "rag_search_logs"("wasAiFallback");
CREATE INDEX "rag_search_logs_flowStep_idx" ON "rag_search_logs"("flowStep");
CREATE INDEX "rag_search_logs_aiProvider_idx" ON "rag_search_logs"("aiProvider");

-- Comentários para documentação
COMMENT ON COLUMN "rag_search_logs"."flowStep" IS '1=RAG inicial, 2=IA fallback, 3=RAG validação final';
COMMENT ON COLUMN "rag_search_logs"."totalSteps" IS 'Total de steps executados (1, 2 ou 3)';
COMMENT ON COLUMN "rag_search_logs"."aiProvider" IS 'Provider de IA usado se ragMode=AI ou flowStep=2';
COMMENT ON COLUMN "rag_search_logs"."wasAiFallback" IS 'true se precisou usar IA porque RAG falhou';

-- ========================================
-- 2. Atualizar tabela ai_usage_logs
-- ========================================

-- Adicionar campos de contexto RAG
ALTER TABLE "ai_usage_logs"
ADD COLUMN "ragSearchLogId" TEXT,
ADD COLUMN "ragInitialFound" BOOLEAN,
ADD COLUMN "ragInitialScore" DECIMAL(5,4),
ADD COLUMN "ragInitialCategory" TEXT,
ADD COLUMN "aiCategoryId" TEXT,
ADD COLUMN "aiCategoryName" TEXT,
ADD COLUMN "aiConfidence" DECIMAL(5,4),
ADD COLUMN "finalCategoryId" TEXT,
ADD COLUMN "finalCategoryName" TEXT,
ADD COLUMN "wasRagFallback" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "needsSynonymLearning" BOOLEAN NOT NULL DEFAULT false;

-- Criar índices para otimizar queries de análise
CREATE INDEX "ai_usage_logs_ragSearchLogId_idx" ON "ai_usage_logs"("ragSearchLogId");
CREATE INDEX "ai_usage_logs_wasRagFallback_idx" ON "ai_usage_logs"("wasRagFallback");
CREATE INDEX "ai_usage_logs_needsSynonymLearning_idx" ON "ai_usage_logs"("needsSynonymLearning");

-- Comentários para documentação
COMMENT ON COLUMN "ai_usage_logs"."ragSearchLogId" IS 'ID do RAGSearchLog relacionado (vincula com step 1)';
COMMENT ON COLUMN "ai_usage_logs"."ragInitialFound" IS 'true se RAG encontrou algo no step 1 (mesmo abaixo do threshold)';
COMMENT ON COLUMN "ai_usage_logs"."wasRagFallback" IS 'true se foi fallback de RAG que falhou';
COMMENT ON COLUMN "ai_usage_logs"."needsSynonymLearning" IS 'true se deve extrair sinônimos desta interação';

-- ========================================
-- 3. Queries de verificação
-- ========================================

-- Verificar se as colunas foram criadas corretamente
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'rag_search_logs' 
  AND column_name IN (
    'flowStep', 'totalSteps', 'aiProvider', 'aiModel', 
    'wasAiFallback', 'finalCategoryName'
  )
ORDER BY column_name;

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'ai_usage_logs' 
  AND column_name IN (
    'ragSearchLogId', 'ragInitialFound', 'ragInitialScore', 
    'wasRagFallback', 'needsSynonymLearning'
  )
ORDER BY column_name;

-- Verificar índices criados
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename IN ('rag_search_logs', 'ai_usage_logs')
  AND indexname LIKE '%wasAiFallback%' 
   OR indexname LIKE '%ragSearchLogId%'
   OR indexname LIKE '%needsSynonymLearning%'
ORDER BY tablename, indexname;

-- ========================================
-- 4. Query de teste - Simular análise
-- ========================================

-- Query de exemplo para encontrar casos onde RAG falhou mas IA acertou
-- (Vai retornar vazio até que novos logs sejam gerados com os campos)
SELECT 
  ai.inputText as query_original,
  ai.ragInitialScore as rag_score,
  ai.ragInitialCategory as rag_sugestao,
  ai.aiCategoryName as ia_categoria,
  ai.aiConfidence as ia_confianca,
  ai.finalCategoryName as categoria_final,
  ai.createdAt
FROM ai_usage_logs ai
WHERE 
  ai.wasRagFallback = true
  AND ai.success = true
  AND ai.needsSynonymLearning = true
ORDER BY ai.createdAt DESC
LIMIT 10;

-- ========================================
-- NOTAS IMPORTANTES
-- ========================================

-- 1. Esta migration adiciona colunas opcionais (nullable) para não quebrar
--    a aplicação existente. Os valores serão NULL até que o código seja
--    atualizado para preencher estes campos.

-- 2. Logs antigos (antes desta migration) terão valores NULL nos novos campos.
--    Isso é esperado e não causa problemas.

-- 3. Após aplicar esta migration, o código dos services (RAG e AI) deve ser
--    atualizado para popular estes novos campos.

-- 4. Os índices criados otimizam as queries de análise descritas em
--    docs/RAG_TRACKING_ANALYSIS.md

-- 5. Para aplicar esta migration:
--    - Em desenvolvimento: npx prisma migrate dev
--    - Em produção: npx prisma migrate deploy
