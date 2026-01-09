import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔍 Testando fluxo completo do webchat...\n');

  try {
    // 1. Verificar usuário webchat
    const webchatUsers = await prisma.userCache.findMany({
      where: {
        phoneNumber: {
          startsWith: 'webchat-',
        },
      },
      select: {
        id: true,
        phoneNumber: true,
        gastoCertoId: true,
        name: true,
        email: true,
        activeAccountId: true,
      },
      take: 5,
    });

    console.log(`👥 Usuários webchat encontrados: ${webchatUsers.length}`);
    webchatUsers.forEach((user) => {
      console.log(`   - ${user.name} (${user.phoneNumber})`);
      console.log(`     gastoCertoId: ${user.gastoCertoId}`);
      console.log(`     activeAccountId: ${user.activeAccountId}`);
    });

    if (webchatUsers.length === 0) {
      console.log('\n❌ Nenhum usuário webchat encontrado!');
      console.log('   Execute uma mensagem no webchat primeiro para criar o usuário.');
      return;
    }

    // 2. O índice RAG está em cache (Redis ou memória), não no banco
    console.log('\n📊 Nota: Índice RAG está em cache (Redis/memória), não no banco');

    // 3. Verificar logs RAG dos usuários webchat
    console.log('\n📋 Logs RAG dos usuários webchat:');
    
    for (const user of webchatUsers) {
      const logs = await prisma.rAGSearchLog.findMany({
        where: {
          userId: user.gastoCertoId,
        },
        orderBy: { createdAt: 'desc' },
        take: 3,
        select: {
          query: true,
          bestMatch: true,
          bestScore: true,
          success: true,
          createdAt: true,
        },
      });

      console.log(`\n   Usuário: ${user.name}`);
      console.log(`   Total de logs: ${logs.length}`);
      
      if (logs.length > 0) {
        logs.forEach((log, idx) => {
          console.log(`     ${idx + 1}. "${log.query}" → ${log.bestMatch || 'NENHUM'} (${log.bestScore ? (Number(log.bestScore) * 100).toFixed(1) + '%' : 'N/A'})`);
        });
      } else {
        console.log(`     ❌ Nenhum log encontrado`);
      }
    }

    // 4. Verificar últimas transações via webchat
    console.log('\n💰 Últimas transações (todas plataformas):');
    
    const recentTransactions = await prisma.$queryRaw<any[]>`
      SELECT 
        uc."phoneNumber",
        uc."name" as user_name,
        jsonb_pretty(ailog."inputData") as input_data,
        ailog."aiCategoryName",
        ailog."createdAt"
      FROM "AIUsageLog" ailog
      INNER JOIN "UserCache" uc ON uc."id" = ailog."userCacheId"
      WHERE ailog."operation" = 'EXTRACT_TRANSACTION'
        AND ailog."createdAt" >= NOW() - INTERVAL '1 day'
      ORDER BY ailog."createdAt" DESC
      LIMIT 10
    `;

    console.log(`   Total: ${recentTransactions.length}`);
    recentTransactions.forEach((tx, idx) => {
      console.log(`\n   ${idx + 1}. ${tx.user_name} (${tx.phoneNumber})`);
      console.log(`      Categoria: ${tx.aiCategoryName || 'N/A'}`);
      console.log(`      Data: ${new Date(tx.createdAt).toLocaleString('pt-BR')}`);
    });

  } catch (error) {
    console.error('❌ Erro:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
