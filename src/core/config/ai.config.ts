import { registerAs } from '@nestjs/config';

/**
 * Configuração de AI Providers
 *
 * ⚠️  API Keys agora são armazenadas no banco de dados (AIProviderConfig)
 * ⚠️  Configurações de provider, cache, fallback estão no banco (AISettings)
 *
 * Este arquivo mantém apenas:
 * 1. API Keys como FALLBACK para desenvolvimento local
 * 2. URLs base e modelos default (que podem ser sobrescritos pelo banco)
 *
 * Em produção, configure tudo via banco de dados.
 */
export const aiConfig = registerAs('ai', () => ({
  // OpenAI
  openai: {
    apiKey: process.env.OPENAI_API_KEY, // Fallback para dev
  },

  // Google Gemini
  google: {
    apiKey: process.env.GOOGLE_AI_API_KEY, // Fallback para dev
  },

  // Groq
  groq: {
    apiKey: process.env.GROQ_API_KEY, // Fallback para dev
  },

  // DeepSeek
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY, // Fallback para dev
    baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  },
}));
