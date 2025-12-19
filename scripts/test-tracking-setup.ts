import { PrismaClient } from '@prisma/client';

/**
 * Script de Teste Rápido - Sistema de Tracking RAG
 * 
 * Valida que todas as migrations foram aplicadas corretamente
 * e que os novos campos estão disponíveis.
 * 
 * USO:
 * ```bash
 * npx ts-node scripts/test-tracking-setup.ts
 * ```
 */

const prisma = new PrismaClient();

async function main() {
  console.log('🔍 Testando Sistema de Tracking RAG+AI\n');
  console.log('═'.repeat(60));

  try {
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 1. VALIDAR TABELAS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('\n1️⃣  Validando estrutura das tabelas...\n');

    // RAGSearchLog
    const ragLogCount = await prisma.rAGSearchLog.count();
    console.log(`   ✅ RAGSearchLog: ${ragLogCount} registros`);

    // AIUsageLog
    const aiLogCount = await prisma.aIUsageLog.count();
    console.log(`   ✅ AIUsageLog: ${aiLogCount} registros`);

    // UserSynonym
    const synonymCount = await prisma.userSynonym.count();
    console.log(`   ✅ UserSynonym: ${synonymCount} registros`);

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 2. VALIDAR NOVOS CAMPOS - RAGSearchLog
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('\n2️⃣  Validando novos campos em RAGSearchLog...\n');

    const ragLog = await prisma.rAGSearchLog.findFirst({
      select: {
        id: true,
        query: true,
        success: true,
        // 🆕 Novos campos
        flowStep: true,
        totalSteps: true,
        aiProvider: true,
        aiModel: true,
        aiConfidence: true,
        aiCategoryId: true,
        aiCategoryName: true,
        finalCategoryId: true,
        finalCategoryName: true,
        ragInitialScore: true,
        ragFinalScore: true,
        wasAiFallback: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (ragLog) {
      console.log('   📋 Exemplo de RAGSearchLog:');
      console.log(`      ID: ${ragLog.id.substring(0, 8)}...`);
      console.log(`      Query: "${ragLog.query}"`);
      console.log(`      Success: ${ragLog.success ? '✅' : '❌'}`);
      console.log(`      Flow: Step ${ragLog.flowStep}/${ragLog.totalSteps}`);
      console.log(`      AI Provider: ${ragLog.aiProvider || 'N/A'}`);
      console.log(`      AI Model: ${ragLog.aiModel || 'N/A'}`);
      console.log(`      Was AI Fallback: ${ragLog.wasAiFallback ? '✅' : '❌'}`);
      console.log(`      Final Category: ${ragLog.finalCategoryName || 'N/A'}`);
    } else {
      console.log('   ⚠️  Nenhum log RAG encontrado (esperado em banco novo)');
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 3. VALIDAR NOVOS CAMPOS - AIUsageLog
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('\n3️⃣  Validando novos campos em AIUsageLog...\n');

    const aiLog = await prisma.aIUsageLog.findFirst({
      select: {
        id: true,
        operation: true,
        provider: true,
        model: true,
        totalTokens: true,
        estimatedCost: true,
        // 🆕 Novos campos
        ragSearchLogId: true,
        ragInitialFound: true,
        ragInitialScore: true,
        ragInitialCategory: true,
        aiCategoryId: true,
        aiCategoryName: true,
        aiConfidence: true,
        finalCategoryId: true,
        finalCategoryName: true,
        wasRagFallback: true,
        needsSynonymLearning: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (aiLog) {
      console.log('   📋 Exemplo de AIUsageLog:');
      console.log(`      ID: ${aiLog.id.substring(0, 8)}...`);
      console.log(`      Operation: ${aiLog.operation}`);
      console.log(`      Provider: ${aiLog.provider} (${aiLog.model})`);
      console.log(`      Tokens: ${aiLog.totalTokens}`);
      console.log(`      Cost: $${Number(aiLog.estimatedCost).toFixed(6)}`);
      console.log(`      RAG Context: ${aiLog.ragSearchLogId ? '✅' : '❌'}`);
      console.log(`      Needs Learning: ${aiLog.needsSynonymLearning ? '✅' : '❌'}`);
    } else {
      console.log('   ⚠️  Nenhum log AI encontrado (esperado em banco novo)');
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 4. CRIAR LOG DE TESTE
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('\n4️⃣  Criando log de teste...\n');

    const testRagLog = await prisma.rAGSearchLog.create({
      data: {
        userId: 'test-user-setup',
        query: 'teste de tracking',
        queryNormalized: 'teste de tracking',
        matches: [],
        bestMatch: null,
        bestScore: null,
        threshold: 0.7,
        success: false,
        ragMode: 'BM25',
        responseTime: 50,
        // 🆕 Novos campos
        flowStep: 1,
        totalSteps: 1,
        aiProvider: null,
        aiModel: null,
        aiConfidence: null,
        aiCategoryId: null,
        aiCategoryName: null,
        finalCategoryId: null,
        finalCategoryName: null,
        ragInitialScore: null,
        ragFinalScore: null,
        wasAiFallback: false,
      },
    });

    console.log(`   ✅ Log de teste criado: ${testRagLog.id.substring(0, 8)}...`);

    // Deletar log de teste
    await prisma.rAGSearchLog.delete({ where: { id: testRagLog.id } });
    console.log('   ✅ Log de teste removido');

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 5. RESUMO
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    console.log('\n' + '═'.repeat(60));
    console.log('\n✅ SISTEMA DE TRACKING CONFIGURADO CORRETAMENTE!\n');
    console.log('📊 Resumo:');
    console.log(`   • RAGSearchLog: ${ragLogCount} registros (12 novos campos)`);
    console.log(`   • AIUsageLog: ${aiLogCount} registros (11 novos campos)`);
    console.log(`   • UserSynonym: ${synonymCount} registros`);
    console.log('\n🚀 Pronto para uso!\n');
    console.log('Próximos passos:');
    console.log('   1. Processar transações para gerar dados de tracking');
    console.log('   2. Rodar: npx ts-node scripts/analyze-rag-logs.ts');
    console.log('   3. Analisar relatórios e identificar oportunidades\n');

  } catch (error) {
    console.error('\n❌ Erro ao validar sistema:', error);
    console.error('\nDetalhes:', error.message);
    
    if (error.message.includes('column') || error.message.includes('does not exist')) {
      console.error('\n💡 Solução: Rodar migrations novamente:');
      console.error('   npx prisma migrate deploy');
    }

    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
