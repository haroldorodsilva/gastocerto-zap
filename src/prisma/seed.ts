import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Iniciando seed do banco de dados...');

  // Seed AI Provider Configs
  console.log('📊 Criando configurações de provedores de IA...');

  const providers = [
    {
      provider: 'openai',
      displayName: 'OpenAI',
      enabled: false,
      textModel: 'gpt-4o',
      visionModel: 'gpt-4o',
      audioModel: 'whisper-1',
      rpmLimit: 500,
      tpmLimit: 150000,
      inputCostPer1M: 2.5,
      outputCostPer1M: 10.0,
      supportsVision: true,
      supportsAudio: true,
      supportsCache: false,
      cacheEnabled: false,
      priority: 3,
      fallbackEnabled: true,
      metadata: {
        description: 'OpenAI GPT-4o - Melhor qualidade, mais caro',
        features: ['text', 'vision', 'audio'],
      },
    },
    {
      provider: 'google_gemini',
      displayName: 'Google Gemini',
      enabled: false,
      textModel: 'gemini-1.5-pro',
      visionModel: 'gemini-1.5-pro',
      rpmLimit: 1000,
      tpmLimit: 1000000,
      inputCostPer1M: 1.25,
      outputCostPer1M: 5.0,
      supportsVision: true,
      supportsAudio: false,
      supportsCache: true,
      cacheEnabled: false,
      priority: 2,
      fallbackEnabled: true,
      metadata: {
        description: 'Google Gemini 1.5 Pro - Boa qualidade, custo médio',
        features: ['text', 'vision', 'cache'],
      },
    },
    {
      provider: 'groq',
      displayName: 'Groq',
      enabled: false,
      textModel: 'llama-3.1-70b-versatile',
      rpmLimit: 30,
      tpmLimit: 6000,
      inputCostPer1M: 0.59,
      outputCostPer1M: 0.79,
      supportsVision: false,
      supportsAudio: false,
      supportsCache: false,
      cacheEnabled: false,
      priority: 1,
      fallbackEnabled: true,
      metadata: {
        description: 'Groq Llama 3.1 70B - Muito rápido e barato',
        features: ['text'],
        notes: 'Rate limits baixos, ideal para texto simples',
      },
    },
    {
      provider: 'deepseek',
      displayName: 'DeepSeek',
      enabled: false,
      baseUrl: 'https://api.deepseek.com',
      textModel: 'deepseek-chat',
      rpmLimit: 60,
      tpmLimit: 1000000,
      inputCostPer1M: 0.28,
      outputCostPer1M: 0.42,
      cacheCostPer1M: 0.028,
      supportsVision: false,
      supportsAudio: false,
      supportsCache: true,
      cacheEnabled: false,
      priority: 1,
      fallbackEnabled: true,
      metadata: {
        description: 'DeepSeek v3 - Mais barato, boa qualidade',
        features: ['text', 'cache'],
        notes: 'Cache hit 10x mais barato (90% desconto)',
      },
    },
  ];

  for (const provider of providers) {
    const existing = await prisma.aIProviderConfig.findUnique({
      where: { provider: provider.provider },
    });

    if (existing) {
      console.log(`⏭️  Provider ${provider.displayName} já existe, pulando...`);
      continue;
    }

    await prisma.aIProviderConfig.create({
      data: provider as any,
    });

    console.log(`✅ Provider ${provider.displayName} criado`);
  }

  // Seed AI Settings
  console.log('⚙️  Criando configurações globais de IA...');

  const existingSettings = await prisma.aISettings.findFirst();

  if (!existingSettings) {
    await prisma.aISettings.create({
      data: {
        // Providers por operação
        textProvider: 'openai',
        imageProvider: 'google_gemini',
        audioProvider: 'groq',
        categoryProvider: 'groq',
        // Fallback
        primaryProvider: 'openai',
        fallbackEnabled: true,
        fallbackTextChain: ['openai', 'groq', 'deepseek', 'google_gemini'],
        fallbackImageChain: ['google_gemini', 'openai'],
        fallbackAudioChain: ['groq', 'openai'],
        fallbackCategoryChain: ['groq', 'deepseek', 'google_gemini', 'openai'],
        cacheEnabled: false,
        cacheTTL: 3600,
        rateLimitEnabled: true,
      },
    });
    console.log('✅ Configurações globais de IA criadas');
  } else {
    console.log('ℹ️  Configurações globais de IA já existem, pulando...');
  }

  console.log('✅ Seed concluído com sucesso!');
}

main()
  .catch((e) => {
    console.error('❌ Erro ao executar seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
