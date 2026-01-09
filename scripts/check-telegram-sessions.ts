import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔍 Verificando sessões do Telegram...\n');

  const sessions = await prisma.telegramSession.findMany({
    orderBy: { createdAt: 'desc' },
  });

  console.log(`📊 Total de sessões: ${sessions.length}\n`);

  sessions.forEach((session, index) => {
    console.log(`${index + 1}. ${session.name}`);
    console.log(`   ID: ${session.id}`);
    console.log(`   SessionId: ${session.sessionId}`);
    console.log(`   Status: ${session.status}`);
    console.log(`   isActive: ${session.isActive ? '✅' : '❌'}`);
    console.log(`   Token: ${session.token ? session.token.substring(0, 20) + '...' : 'N/A'}`);
    console.log(`   Criado: ${session.createdAt.toLocaleString('pt-BR')}`);
    console.log();
  });

  // Mostrar qual vai ser auto-iniciada
  const activeSession = sessions.find((s) => s.isActive);
  if (activeSession) {
    console.log(`⚠️  Sessão que será AUTO-INICIADA:`);
    console.log(`   ${activeSession.name} (${activeSession.sessionId})`);
  } else {
    console.log(`✅ Nenhuma sessão marcada para auto-iniciar (isActive=false em todas)`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
