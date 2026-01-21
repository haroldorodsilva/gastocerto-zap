-- AlterTable
ALTER TABLE "user_cache" ADD COLUMN "canUseGastoZap" BOOLEAN NOT NULL DEFAULT false;

-- Update existing records: set canUseGastoZap = hasActiveSubscription
UPDATE "user_cache" SET "canUseGastoZap" = "hasActiveSubscription";
