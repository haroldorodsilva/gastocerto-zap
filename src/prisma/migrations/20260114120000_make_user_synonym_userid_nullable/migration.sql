-- AlterTable: Tornar userId e categoryId nullable para suportar sinônimos globais
-- Sinônimos globais terão userId = NULL e usarão apenas categoryName para matching

-- Primeiro, atualizar todos os registros existentes com 'GLOBAL' para NULL
UPDATE "user_synonyms" SET "userId" = NULL WHERE "userId" = 'GLOBAL';

-- Limpar categoryId que sejam 'GLOBAL' (deixar NULL para sinônimos globais)
UPDATE "user_synonyms" SET "categoryId" = NULL WHERE "categoryId" = 'GLOBAL' OR "userId" IS NULL;

-- Tornar as colunas nullable
ALTER TABLE "user_synonyms" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "user_synonyms" ALTER COLUMN "categoryId" DROP NOT NULL;

-- Remover o constraint único antigo (userId, keyword) se existir
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_synonyms_userId_keyword_key') THEN
    ALTER TABLE "user_synonyms" DROP CONSTRAINT "user_synonyms_userId_keyword_key";
  END IF;
END $$;

-- Criar novo constraint único que permite múltiplos registros com userId NULL
-- mas mantém unicidade por userId quando não for NULL
DROP INDEX IF EXISTS "user_synonyms_userId_keyword_key";
CREATE UNIQUE INDEX "user_synonyms_userId_keyword_key" 
ON "user_synonyms" ("userId", "keyword") 
WHERE "userId" IS NOT NULL;

-- Criar índice para sinônimos globais (userId NULL) se não existir
DROP INDEX IF EXISTS "user_synonyms_global_keyword_idx";
CREATE INDEX "user_synonyms_global_keyword_idx" 
ON "user_synonyms" ("keyword") 
WHERE "userId" IS NULL;
