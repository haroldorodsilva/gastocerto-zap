import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔍 Verificando logs RAG...\n');

  try {
    // 1. Total de logs
    const totalLogs = await prisma.rAGSearchLog.count();
    console.log(`📊 Total de logs RAG: ${totalLogs}`);

    // 2. Logs da última hora
    const recentLogs = await prisma.rAGSearchLog.count({
      where: {
        createdAt: {
          gte: new Date(Date.now() - 60 * 60 * 1000), // última hora
        },
      },
    });
    console.log(`📊 Logs na última hora: ${recentLogs}`);

    // 3. Últimos 10 logs
    const latestLogs = await prisma.rAGSearchLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        userId: true,
        query: true,
        bestMatch: true,
        bestScore: true,
        success: true,
        ragMode: true,
        flowStep: true,
        totalSteps: true,
        wasAiFallback: true,
        createdAt: true,
      },
    });

    console.log('\n📋 Últimos 10 logs RAG:');
    latestLogs.forEach((log, idx) => {
      console.log(`\n${idx + 1}. ${log.query}`);
      console.log(`   ID: ${log.id.substring(0, 8)}...`);
      console.log(`   Match: ${log.bestMatch || 'NENHUM'}`);
      console.log(`   Score: ${log.bestScore ? (Number(log.bestScore) * 100).toFixed(1) + '%' : 'N/A'}`);
      console.log(`   Success: ${log.success ? '✅' : '❌'}`);
      console.log(`   Flow: Step ${log.flowStep}/${log.totalSteps}`);
      console.log(`   AI Fallback: ${log.wasAiFallback ? '✅' : '❌'}`);
      console.log(`   Criado: ${log.createdAt.toLocaleString('pt-BR')}`);
    });

    // 4. Verificar logs com queries específicas dos testes
    console.log('\n🔍 Verificando logs dos testes recentes...');
    
    const testQueries = [
      'gastei 50 reais na farmacia',
      'gastei 50 reais com comida',
    ];

    for (const query of testQueries) {
      const logs = await prisma.rAGSearchLog.findMany({
        where: {
          query: {
            contains: query.substring(0, 20), // Buscar partial match
          },
          createdAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // últimas 24h
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 1,
      });

      console.log(`\n📝 Query: "${query}"`);
      if (logs.length > 0) {
        const log = logs[0];
        console.log(`   ✅ Log encontrado!`);
        console.log(`   Match: ${log.bestMatch || 'NENHUM'}`);
        console.log(`   Score: ${log.bestScore ? (Number(log.bestScore) * 100).toFixed(1) + '%' : 'N/A'}`);
        console.log(`   Success: ${log.success ? '✅' : '❌'}`);
      } else {
        console.log(`   ❌ Nenhum log encontrado para esta query`);
      }
    }

    // 5. Verificar configuração do RAG
    console.log('\n⚙️ Verificando configuração do RAG...');
    const aiSettings = await prisma.aISettings.findFirst();
    
    if (aiSettings) {
      console.log(`   ragEnabled: ${aiSettings.ragEnabled ? '✅' : '❌'}`);
      console.log(`   ragThreshold: ${aiSettings.ragThreshold}`);
      console.log(`   ragAiEnabled: ${aiSettings.ragAiEnabled ? '✅' : '❌'}`);
      console.log(`   ragAiProvider: ${aiSettings.ragAiProvider || 'N/A'}`);
    } else {
      console.log('   ❌ AISettings não encontrado!');
    }

    // 6. Verificar sinônimos para "comida" e "gás"
    console.log('\n🔤 Verificando sinônimos...');
    
    const synonyms = await prisma.userSynonym.findMany({
      where: {
        OR: [
          { keyword: { contains: 'comida' } },
          { keyword: { contains: 'gas' } },
          { keyword: { contains: 'gás' } },
          { categoryName: { contains: 'Alimentação' } },
          { categoryName: { contains: 'Gás' } },
        ],
      },
      take: 20,
    });

    console.log(`   Total de sinônimos relacionados: ${synonyms.length}`);
    synonyms.forEach((syn) => {
      console.log(`   - "${syn.keyword}" → ${syn.categoryName}${syn.subCategoryName ? ` > ${syn.subCategoryName}` : ''}`);
    });

  } catch (error) {
    console.error('❌ Erro:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
