-- Alterar user_synonyms para corresponder ao schema atual

-- Remover colunas antigas se existirem
ALTER TABLE "user_synonyms" DROP COLUMN IF EXISTS "synonyms";
ALTER TABLE "user_synonyms" DROP COLUMN IF EXISTS "isActive";

-- Adicionar novas colunas se não existirem
ALTER TABLE "user_synonyms" ADD COLUMN IF NOT EXISTS "subCategoryId" TEXT;
ALTER TABLE "user_synonyms" ADD COLUMN IF NOT EXISTS "subCategoryName" TEXT;
ALTER TABLE "user_synonyms" ADD COLUMN IF NOT EXISTS "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1.0;

