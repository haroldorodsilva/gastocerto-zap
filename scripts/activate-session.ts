import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function activateSession() {
  try {
    console.log('🔧 Ativando sessão WhatsApp...\n');

    const sessions = await prisma.whatsAppSession.findMany({
      orderBy: { createdAt: 'desc' },
      take: 1,
    });

    if (sessions.length === 0) {
      console.log('❌ Nenhuma sessão ativa encontrada');
      return;
    }

    const session = sessions[0];
    
    // Atualizar para CONNECTING para que o SessionManager tente conectar
    const updated = await prisma.whatsAppSession.update({
      where: { id: session.id },
      data: {
        status: 'CONNECTING',
        isActive: true,
      },
    });

    console.log('✅ Sessão atualizada para CONNECTING!\n');
    console.log('📋 Detalhes:');
    console.log(`   - Nome: ${updated.name}`);
    console.log(`   - Session ID: ${updated.sessionId}`);
    console.log(`   - Status: ${updated.status}`);
    console.log(`   - ID: ${updated.id}\n`);

    console.log('🔄 Agora reinicie a aplicação ou ela deve tentar conectar automaticamente');
    console.log('📱 O QR Code será exibido nos logs quando a aplicação tentar conectar\n');
  } catch (error) {
    console.error('❌ Erro:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

activateSession();
