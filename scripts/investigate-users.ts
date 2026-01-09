import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔍 Investigando usuários e logs...\n');

  try {
    // 1. Todos os usuários
    const allUsers = await prisma.userCache.findMany({
      select: {
        id: true,
        phoneNumber: true,
        gastoCertoId: true,
        name: true,
        email: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    console.log(`👥 Total de usuários: ${allUsers.length}`);
    allUsers.forEach((user, idx) => {
      console.log(`\n${idx + 1}. ${user.name}`);
      console.log(`   phoneNumber: ${user.phoneNumber}`);
      console.log(`   gastoCertoId: ${user.gastoCertoId}`);
      console.log(`   email: ${user.email || 'N/A'}`);
      console.log(`   criado: ${user.createdAt.toLocaleString('pt-BR')}`);
    });

    // 2. Logs AI das últimas 24h
    console.log('\n\n🤖 Logs de IA (últimas 24h):');
    
    const aiLogs = await prisma.aIUsageLog.findMany({
      where: {
        createdAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        operation: true,
        aiCategoryName: true,
        inputText: true,
        phoneNumber: true,
        createdAt: true,
        userCacheId: true,
      },
    });

    console.log(`   Total: ${aiLogs.length}`);
    
    aiLogs.forEach((log, idx) => {
      const inputText = log.inputText || 'N/A';
      console.log(`\n   ${idx + 1}. ${log.operation}`);
      console.log(`      Phone: ${log.phoneNumber}`);
      console.log(`      Input: ${inputText.substring(0, 50)}...`);
      console.log(`      Categoria: ${log.aiCategoryName || 'N/A'}`);
      console.log(`      Data: ${log.createdAt.toLocaleString('pt-BR')}`);
    });

    // 3. Verificar se há logs RAG (qualquer usuário)
    console.log('\n\n📊 Logs RAG (todos):');
    
    const ragLogs = await prisma.rAGSearchLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    console.log(`   Total: ${ragLogs.length}`);

    // 4. Procurar por queries específicas nos logs AI
    console.log('\n\n🔍 Procurando queries específicas nos logs AI...');
    
    const specificQueries = [
      'gastei 50 reais na farmacia',
      'gastei 50 reais com comida',
      'farmacia',
      'comida',
    ];

    for (const query of specificQueries) {
      const logs = await prisma.aIUsageLog.findMany({
        where: {
          inputText: {
            contains: query.substring(0, 15),
          },
          createdAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
          },
        },
        select: {
          aiCategoryName: true,
          inputText: true,
          phoneNumber: true,
          createdAt: true,
          userCacheId: true,
        },
      });

      if (logs.length > 0) {
        console.log(`\n   ✅ Encontrado: "${query}"`);
        logs.forEach((log) => {
          console.log(`      Phone: ${log.phoneNumber}`);
          console.log(`      Input: ${log.inputText?.substring(0, 50)}`);
          console.log(`      Categoria: ${log.aiCategoryName}`);
          console.log(`      Data: ${log.createdAt.toLocaleString('pt-BR')}`);
        });
      }
    }

  } catch (error) {
    console.error('❌ Erro:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
