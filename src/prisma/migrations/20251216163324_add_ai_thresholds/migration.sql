-- Migration: Add transaction thresholds to AISettings
-- CreateTable
ALTER TABLE "ai_settings" ADD COLUMN "auto_register_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.90;
ALTER TABLE "ai_settings" ADD COLUMN "min_confidence_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.50;

-- Update existing AIProviderConfig with rate limits if needed
UPDATE "ai_provider_configs"
SET 
  "rpmLimit" = CASE 
    WHEN "provider" = 'openai' THEN 500
    WHEN "provider" = 'google_gemini' THEN 1000
    WHEN "provider" = 'groq' THEN 30
    WHEN "provider" = 'deepseek' THEN 60
    ELSE 0
  END,
  "tpmLimit" = CASE 
    WHEN "provider" = 'openai' THEN 150000
    WHEN "provider" = 'google_gemini' THEN 1000000
    WHEN "provider" = 'groq' THEN 6000
    WHEN "provider" = 'deepseek' THEN 1000000
    ELSE 0
  END
WHERE "rpmLimit" IS NULL OR "rpmLimit" = 0;

-- Seed AISettings if not exists
INSERT INTO "ai_settings" (
  "id",
  "textProvider",
  "imageProvider",
  "audioProvider",
  "categoryProvider",
  "fallbackEnabled",
  "cacheEnabled",
  "cacheTTL",
  "ragEnabled",
  "ragAiEnabled",
  "ragAiProvider",
  "ragThreshold",
  "auto_register_threshold",
  "min_confidence_threshold",
  "created_at",
  "updated_at"
)
SELECT 
  gen_random_uuid(),
  'groq',
  'google_gemini',
  'groq',
  'groq',
  true,
  true,
  3600,
  true,
  false,
  'groq',
  0.6,
  0.90,
  0.50,
  NOW(),
  NOW()
WHERE NOT EXISTS (SELECT 1 FROM "ai_settings" LIMIT 1);
