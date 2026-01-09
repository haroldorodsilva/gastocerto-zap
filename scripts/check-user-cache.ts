import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();

  try {
    await prisma.$connect();
    console.log('✅ Conectado ao banco\n');

    console.log('📊 UserCache - Últimos 20 usuários:\n');
    const users = await prisma.userCache.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 20,
      select: {
        id: true,
        gastoCertoId: true,
        phoneNumber: true,
        name: true,
        updatedAt: true,
        activeAccountId: true,
      },
    });

    users.forEach((user, i) => {
      const lastUpdate = user.updatedAt.toISOString();
      console.log(
        `${i + 1}. Phone: ${user.phoneNumber} | Name: ${user.name || 'N/A'} | GastoCertoId: ${user.gastoCertoId} | Updated: ${lastUpdate}`,
      );
    });

    console.log('\n📋 Total de usuários no cache:', await prisma.userCache.count());

  } catch (error) {
    console.error('❌ Erro:', error);
  } finally {
    await prisma.$disconnect();
    process.exit(0);
  }
}

main();
