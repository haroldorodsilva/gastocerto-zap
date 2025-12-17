-- ===============================================
-- Seed Manual para Produção
-- ===============================================
-- Execute este SQL diretamente no banco Neon se necessário popular os dados iniciais
-- (alternativa ao npx prisma db seed que requer ts-node)

-- 1. Criar providers de IA
INSERT INTO ai_provider_configs (id, name, enabled, "textProvider", "imageProvider", "rpmLimit", created_at, updated_at)
VALUES 
  ('openai', 'OpenAI', true, 'gpt-4o-mini', NULL, 500, NOW(), NOW()),
  ('google', 'Google Gemini', true, 'gemini-2.0-flash-exp', 'gemini-2.0-flash-exp', 1000, NOW(), NOW()),
  ('groq', 'Groq', true, 'llama-3.3-70b-versatile', NULL, 30, NOW(), NOW()),
  ('deepseek', 'DeepSeek', false, 'deepseek-chat', NULL, 60, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- 2. Criar configurações globais de IA
INSERT INTO ai_settings (id, "autoRegisterThreshold", "minConfidenceThreshold", "preferredTextProvider", "preferredImageProvider", created_at, updated_at)
VALUES (
  1,
  0.80,
  0.70,
  'groq',
  'google',
  NOW(),
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  updated_at = NOW();

-- Verificar resultado
SELECT 'Providers criados:' as status, COUNT(*) as total FROM ai_provider_configs;
SELECT 'Settings criados:' as status, * FROM ai_settings;
