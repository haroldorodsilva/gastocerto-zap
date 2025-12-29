import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function createTestSession() {
  try {
    console.log('🔧 Criando sessão WhatsApp de teste...\n');

    const sessionId = `whatsapp-${Date.now()}`;
    const testPhone = '5566999999999'; // Número de teste

    const session = await prisma.whatsAppSession.create({
      data: {
        sessionId,
        name: 'Teste Local - GastoCerto',
        phoneNumber: testPhone,
        status: 'DISCONNECTED',
        isActive: true,
      },
    });

    console.log('✅ Sessão criada com sucesso!\n');
    console.log('📋 Detalhes da sessão:');
    console.log(`   - Nome: ${session.name}`);
    console.log(`   - Session ID: ${session.sessionId}`);
    console.log(`   - Telefone: ${session.phoneNumber}`);
    console.log(`   - Status: ${session.status}`);
    console.log(`   - Ativa: ${session.isActive ? 'Sim' : 'Não'}\n`);

    console.log('🚀 Agora você pode:');
    console.log('   1. Reiniciar a aplicação para conectar automaticamente');
    console.log('   2. Ou ativar manualmente via API:');
    console.log(`      POST http://localhost:4444/whatsapp/${session.id}/activate`);
    console.log(`\n   3. Para ver o QR code:`);
    console.log(`      GET http://localhost:4444/whatsapp/${session.id}/qr`);
  } catch (error) {
    console.error('❌ Erro ao criar sessão:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

createTestSession();
