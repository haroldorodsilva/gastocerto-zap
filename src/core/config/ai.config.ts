import { registerAs } from '@nestjs/config';

export const aiConfig = registerAs('ai', () => ({
  provider: process.env.AI_PROVIDER || 'openai',
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-4-turbo-preview',
    visionModel: process.env.OPENAI_VISION_MODEL || 'gpt-4-vision-preview',
    whisperModel: process.env.OPENAI_WHISPER_MODEL || 'whisper-1',
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022',
  },
  google: {
    apiKey: process.env.GOOGLE_AI_API_KEY,
    model: process.env.GOOGLE_MODEL || 'gemini-1.5-pro',
  },
  groq: {
    apiKey: process.env.GROQ_API_KEY,
    model: process.env.GROQ_MODEL || 'llama-3.1-70b-versatile',
  },
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  },
}));
