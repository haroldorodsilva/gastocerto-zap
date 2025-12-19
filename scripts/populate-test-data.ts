import { PrismaClient } from '@prisma/client';

/**
 * Script para popular dados de teste no sistema de tracking
 * 
 * Cria logs simulados de RAG e AI para testar análises
 * 
 * USO:
 * ```bash
 * npx ts-node scripts/populate-test-data.ts
 * ```
 */

const prisma = new PrismaClient();

const TEST_USER_ID = 'cltest123456789';
const TEST_PHONE = '+5511999999999';

// Queries de teste que simulam uso real
const testQueries = [
  // Casos de sucesso RAG
  { query: 'supermercado', category: 'Alimentação', subCategory: 'Supermercado', ragScore: 0.95, success: true },
  { query: 'gasolina posto shell', category: 'Transporte', subCategory: 'Combustível', ragScore: 0.88, success: true },
  { query: 'uber para trabalho', category: 'Transporte', subCategory: 'Aplicativo', ragScore: 0.92, success: true },
  { query: 'almoço restaurante', category: 'Alimentação', subCategory: 'Restaurante', ragScore: 0.85, success: true },
  { query: 'academia smartfit', category: 'Saúde', subCategory: 'Academia', ragScore: 0.90, success: true },
  
  // Casos de falha RAG -> AI Fallback
  { query: 'widget quantum', category: null, subCategory: null, ragScore: 0.2, success: false, aiCategory: 'Eletrônicos', aiConfidence: 0.75 },
  { query: 'produto xyz especial', category: null, subCategory: null, ragScore: 0.15, success: false, aiCategory: 'Outros', aiConfidence: 0.65 },
  { query: 'serviço premium abc', category: null, subCategory: null, ragScore: 0.25, success: false, aiCategory: 'Serviços', aiConfidence: 0.80 },
  
  // Casos intermediários (RAG baixo, mas não zero)
  { query: 'compras diversas', category: 'Alimentação', subCategory: null, ragScore: 0.55, success: false, aiCategory: 'Alimentação', aiConfidence: 0.82 },
  { query: 'pagamento conta', category: 'Moradia', subCategory: null, ragScore: 0.48, success: false, aiCategory: 'Serviços', aiConfidence: 0.78 },
];

async function main() {
  console.log('🚀 Populando dados de teste...\n');

  try {
    // 1. Criar logs RAG
    console.log('1️⃣  Criando RAGSearchLogs...');
    const ragLogs = [];

    for (const test of testQueries) {
      const log = await prisma.rAGSearchLog.create({
        data: {
          userId: TEST_USER_ID,
          query: test.query,
          queryNormalized: test.query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''),
          matches: test.category ? [
            {
              categoryId: `cat_${test.category.toLowerCase()}`,
              categoryName: test.category,
              subCategoryId: test.subCategory ? `sub_${test.subCategory.toLowerCase()}` : null,
              subCategoryName: test.subCategory,
              score: test.ragScore,
              matchedTerms: [test.query.split(' ')[0]],
            },
          ] : [],
          bestMatch: test.category,
          bestScore: test.ragScore,
          threshold: 0.7,
          success: test.success,
          ragMode: 'BM25',
          responseTime: Math.floor(Math.random() * 100) + 20,
          // 🆕 Novos campos
          flowStep: test.aiCategory ? 1 : 1,
          totalSteps: test.aiCategory ? 2 : 1,
          aiProvider: test.aiCategory ? 'openai' : null,
          aiModel: test.aiCategory ? 'gpt-4o-mini' : null,
          aiConfidence: test.aiConfidence || null,
          aiCategoryId: test.aiCategory ? `cat_${test.aiCategory.toLowerCase()}` : null,
          aiCategoryName: test.aiCategory || null,
          finalCategoryId: test.aiCategory ? `cat_${test.aiCategory.toLowerCase()}` : (test.category ? `cat_${test.category.toLowerCase()}` : null),
          finalCategoryName: test.aiCategory || test.category,
          ragInitialScore: test.ragScore,
          ragFinalScore: test.success ? test.ragScore : null,
          wasAiFallback: !!test.aiCategory,
        },
      });

      ragLogs.push(log);
      console.log(`   ✅ ${log.query} → ${test.success ? 'RAG' : 'AI Fallback'}`);

      // Criar log de AI se houver fallback
      if (test.aiCategory) {
        await prisma.aIUsageLog.create({
          data: {
            userCacheId: TEST_USER_ID,
            phoneNumber: TEST_PHONE,
            provider: 'openai',
            model: 'gpt-4o-mini',
            operation: 'CATEGORY_SUGGESTION',
            inputType: 'TEXT',
            inputText: test.query,
            inputTokens: Math.floor(Math.random() * 50) + 20,
            outputTokens: Math.floor(Math.random() * 30) + 10,
            totalTokens: 70,
            estimatedCost: 0.00001,
            responseTime: Math.floor(Math.random() * 1500) + 500,
            success: true,
            // 🆕 Contexto RAG
            ragSearchLogId: log.id,
            ragInitialFound: false,
            ragInitialScore: test.ragScore,
            ragInitialCategory: test.category,
            aiCategoryId: `cat_${test.aiCategory.toLowerCase()}`,
            aiCategoryName: test.aiCategory,
            aiConfidence: test.aiConfidence,
            finalCategoryId: `cat_${test.aiCategory.toLowerCase()}`,
            finalCategoryName: test.aiCategory,
            wasRagFallback: false,
            needsSynonymLearning: true,
          },
        });
      }
    }

    console.log(`\n✅ ${ragLogs.length} RAGSearchLogs criados`);

    // 2. Criar alguns sinônimos de teste
    console.log('\n2️⃣  Criando sinônimos de teste...');

    const synonyms = [
      { keyword: 'mercado', category: 'Alimentação', subCategory: 'Supermercado', source: 'USER_CONFIRMED' },
      { keyword: 'posto', category: 'Transporte', subCategory: 'Combustível', source: 'USER_CONFIRMED' },
      { keyword: '99', category: 'Transporte', subCategory: 'Aplicativo', source: 'AUTO_LEARNED' },
      { keyword: 'ifood', category: 'Alimentação', subCategory: 'Delivery', source: 'AI_SUGGESTED' },
    ];

    for (const syn of synonyms) {
      await prisma.userSynonym.create({
        data: {
          userId: TEST_USER_ID,
          keyword: syn.keyword,
          categoryId: `cat_${syn.category.toLowerCase()}`,
          categoryName: syn.category,
          subCategoryId: `sub_${syn.subCategory.toLowerCase()}`,
          subCategoryName: syn.subCategory,
          source: syn.source as any,
          confidence: Math.random() * 0.3 + 0.7, // 0.7 - 1.0
          usageCount: Math.floor(Math.random() * 10) + 1,
        },
      });
      console.log(`   ✅ "${syn.keyword}" → ${syn.category} (${syn.source})`);
    }

    // 3. Resumo
    console.log('\n' + '═'.repeat(60));
    console.log('\n✅ DADOS DE TESTE POPULADOS COM SUCESSO!\n');
    console.log('📊 Criado:');
    console.log(`   • ${ragLogs.length} RAGSearchLogs`);
    console.log(`   • ${testQueries.filter(t => t.aiCategory).length} AIUsageLogs`);
    console.log(`   • ${synonyms.length} UserSynonyms`);
    console.log('\n🚀 Agora você pode rodar a análise:');
    console.log('   npx ts-node scripts/analyze-rag-logs.ts\n');

  } catch (error) {
    console.error('\n❌ Erro ao popular dados:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
