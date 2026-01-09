import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🛑 Desativando todas as sessões Telegram...\n');

  const result = await prisma.telegramSession.updateMany({
    where: {
      isActive: true,
    },
    data: {
      isActive: false,
      status: 'DISCONNECTED',
    },
  });

  console.log(`✅ ${result.count} sessão(ões) desativada(s)`);

  // Verificar
  const sessions = await prisma.telegramSession.findMany();
  console.log('\n📋 Estado atual:');
  sessions.forEach((s) => {
    console.log(`   ${s.name}: isActive=${s.isActive}, status=${s.status}`);
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
