import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔧 Atualizando configurações de IA...');

  const result = await prisma.aISettings.updateMany({
    data: {
      // 🎯 Providers por operação
      textProvider: 'openai', // OpenAI para texto
      imageProvider: 'google_gemini', // Gemini para imagem
      audioProvider: 'groq', // Groq para áudio
      categoryProvider: 'openai', // OpenAI para categorias

      // 🧠 RAG (Retrieval-Augmented Generation) - ATIVADO
      ragEnabled: true, // ✅ RAG habilitado
      ragThreshold: 0.6, // 60% de confiança mínima
      ragAiEnabled: false, // Usar BM25 (não embeddings de IA)
      ragAiProvider: 'openai', // Provider para embeddings (se habilitado)

      // 🎯 Thresholds de confiança
      autoRegisterThreshold: 0.9, // 90% para auto-registrar
      minConfidenceThreshold: 0.5, // 50% mínimo
    },
  });

  console.log(`✅ ${result.count} registro(s) atualizado(s)`);

  // Verificar resultado
  const settings = await prisma.aISettings.findFirst();
  console.log('\n📊 Configurações atuais:');
  console.log(`   - aiEnabled: ${settings?.aiEnabled}`);
  console.log(`   - ragEnabled: ${settings?.ragEnabled}`);
  console.log(`   - textProvider: ${settings?.textProvider}`);
  console.log(`   - audioProvider: ${settings?.audioProvider}`);
  console.log(`   - imageProvider: ${settings?.imageProvider}`);
  console.log(`   - ragThreshold: ${settings?.ragThreshold}`);
}

main()
  .catch((e) => {
    console.error('❌ Erro:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
