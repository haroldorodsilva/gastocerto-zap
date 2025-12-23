import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function clearAllSessions() {
  try {
    console.log('🧹 Limpando todas as sessões WhatsApp...\n');

    // Listar sessões antes de deletar
    const sessions = await prisma.whatsAppSession.findMany({
      select: {
        sessionId: true,
        status: true,
        createdAt: true,
      },
    });

    console.log(`📋 Encontradas ${sessions.length} sessões:\n`);
    sessions.forEach((session, index) => {
      console.log(`${index + 1}. ${session.sessionId} - Status: ${session.status}`);
    });

    if (sessions.length === 0) {
      console.log('\n✅ Nenhuma sessão encontrada para deletar.');
      return;
    }

    // Deletar todas as sessões
    const result = await prisma.whatsAppSession.deleteMany({});

    console.log(`\n✅ ${result.count} sessão(ões) deletada(s) com sucesso!`);
    console.log('\n💡 Agora você pode:');
    console.log('   1. Aguardar 15-30 minutos');
    console.log('   2. Reiniciar a aplicação');
    console.log('   3. Criar UMA NOVA sessão');
    console.log('   4. Escanear o QR Code UMA ÚNICA VEZ\n');
  } catch (error) {
    console.error('❌ Erro ao limpar sessões:', error);
  } finally {
    await prisma.$disconnect();
  }
}

clearAllSessions();
