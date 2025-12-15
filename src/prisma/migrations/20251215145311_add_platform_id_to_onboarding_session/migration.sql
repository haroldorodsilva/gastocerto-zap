-- AddPlatformIdToOnboardingSession
-- Adiciona campo platformId e migra dados existentes

-- Passo 1: Adicionar coluna platformId (nullable temporariamente)
ALTER TABLE "onboarding_sessions" ADD COLUMN "platformId" TEXT;

-- Passo 2: Copiar dados existentes de phoneNumber para platformId
UPDATE "onboarding_sessions" SET "platformId" = "phoneNumber";

-- Passo 3: Tornar phoneNumber nullable (para telefones que ainda serão coletados)
ALTER TABLE "onboarding_sessions" ALTER COLUMN "phoneNumber" DROP NOT NULL;

-- Passo 4: Tornar platformId obrigatório e único
ALTER TABLE "onboarding_sessions" ALTER COLUMN "platformId" SET NOT NULL;
CREATE UNIQUE INDEX "onboarding_sessions_platformId_key" ON "onboarding_sessions"("platformId");

-- Passo 5: Remover índice único antigo de phoneNumber (se existir)
DROP INDEX IF EXISTS "onboarding_sessions_phoneNumber_key";

-- Passo 6: Criar índice em phoneNumber (não único)
CREATE INDEX IF NOT EXISTS "onboarding_sessions_phoneNumber_idx" ON "onboarding_sessions"("phoneNumber");

-- Passo 7: Recriar índice de platformId (já foi criado como unique acima)
CREATE INDEX IF NOT EXISTS "onboarding_sessions_platformId_idx" ON "onboarding_sessions"("platformId");
