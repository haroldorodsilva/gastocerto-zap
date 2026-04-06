-- AddColumn: accountId em user_synonyms para isolamento n:m por conta
-- Sinônimos aprendidos pelo usuário são específicos por conta.
-- Sinônimos globais (userId=NULL) mantêm accountId=NULL.

ALTER TABLE "user_synonyms" ADD COLUMN "accountId" TEXT;

-- Remover unique constraint antiga
DROP INDEX IF EXISTS "user_synonyms_userId_keyword_key";

-- Criar nova unique constraint incluindo accountId
CREATE UNIQUE INDEX "user_synonyms_userId_accountId_keyword_key"
  ON "user_synonyms"("userId", "accountId", "keyword");

-- Índices adicionais para queries frequentes
CREATE INDEX "user_synonyms_userId_accountId_idx" ON "user_synonyms"("userId", "accountId");
CREATE INDEX "user_synonyms_accountId_idx" ON "user_synonyms"("accountId");
