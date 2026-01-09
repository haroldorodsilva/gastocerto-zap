import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();

  try {
    await prisma.$connect();
    console.log('✅ Conectado ao banco\n');

    // Buscar todos os logs únicos de userId
    console.log('📊 Top 10 userIds com mais logs:\n');
    const topUsers = await prisma.$queryRaw<Array<{ userId: string; count: bigint }>>`
      SELECT "userId", COUNT(*) as count 
      FROM rag_search_logs 
      GROUP BY "userId" 
      ORDER BY count DESC 
      LIMIT 10
    `;

    topUsers.forEach((user, i) => {
      console.log(`${i + 1}. ${user.userId}: ${user.count} logs`);
    });

    console.log('\n📋 Últimos 20 logs de RAG:\n');
    const recentLogs = await prisma.rAGSearchLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        userId: true,
        query: true,
        success: true,
        ragMode: true,
        createdAt: true,
      },
    });

    recentLogs.forEach((log, i) => {
      const date = log.createdAt.toISOString();
      const success = log.success ? '✅' : '❌';
      console.log(
        `${i + 1}. [${date}] User: ${log.userId.substring(0, 30)}... | "${log.query}" | ${success} | Mode: ${log.ragMode}`,
      );
    });

  } catch (error) {
    console.error('❌ Erro:', error);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

main();
