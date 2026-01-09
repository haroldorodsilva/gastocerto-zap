import { PrismaClient } from '@prisma/client';

/**
 * Script simples para testar criação de logs do RAG diretamente no banco
 */

async function main() {
  console.log('🧪 Testando criação de RAGSearchLog...\n');

  const prisma = new PrismaClient();
  
  try {
    await prisma.$connect();
    console.log('✅ Conectado ao banco de dados\n');

    const testUserId = 'test-user-' + Date.now();
    const testQuery = 'padaria pao de queijo';
    
    console.log(`📝 Criando log de teste:`);
    console.log(`   User: ${testUserId}`);
    console.log(`   Query: "${testQuery}"\n`);

    // Tenta criar um log diretamente
    const log = await prisma.rAGSearchLog.create({
      data: {
        userId: testUserId,
        query: testQuery,
        queryNormalized: testQuery.toLowerCase().trim(),
        matches: [],
        bestMatch: 'Padaria',
        bestScore: 0.85,
        threshold: 0.7,
        success: true,
        ragMode: 'BM25',
        responseTime: 120,
        flowStep: 1,
        totalSteps: 1,
        wasAiFallback: false,
      },
    });

    console.log(`✅ Log criado com sucesso!`);
    console.log(`   ID: ${log.id}`);
    console.log(`   Created at: ${log.createdAt.toISOString()}\n`);

    // Verifica se consegue ler o log
    const readLog = await prisma.rAGSearchLog.findUnique({
      where: { id: log.id },
    });

    if (readLog) {
      console.log(`✅ Log lido com sucesso do banco:`);
      console.log(`   Query: "${readLog.query}"`);
      console.log(`   Success: ${readLog.success}`);
      console.log(`   Best Match: ${readLog.bestMatch}\n`);
    } else {
      console.log(`❌ Não foi possível ler o log criado!\n`);
    }

    // Conta logs totais na tabela
    const totalLogs = await prisma.rAGSearchLog.count();
    console.log(`📊 Total de logs na tabela: ${totalLogs}\n`);

    // Lista últimos 10 logs
    console.log('📋 Últimos 10 logs na tabela:');
    const recentLogs = await prisma.rAGSearchLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        userId: true,
        query: true,
        success: true,
        createdAt: true,
      },
    });

    if (recentLogs.length === 0) {
      console.log('   (vazio)\n');
    } else {
      recentLogs.forEach((log, i) => {
        console.log(`   ${i + 1}. [${log.createdAt.toISOString()}] User: ${log.userId.substring(0, 20)}... Query: "${log.query}" (${log.success ? '✅' : '❌'})`);
      });
      console.log();
    }

    // Limpa o log de teste
    await prisma.rAGSearchLog.delete({
      where: { id: log.id },
    });
    console.log('🧹 Log de teste removido\n');

  } catch (error) {
    console.error('❌ Erro:', error);
    if (error instanceof Error) {
      console.error('Stack:', error.stack);
    }
  } finally {
    await prisma.$disconnect();
    console.log('✅ Teste concluído');
    process.exit(0);
  }
}

main();
