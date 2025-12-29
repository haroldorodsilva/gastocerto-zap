import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkSessions() {
  try {
    console.log('🔍 Verificando sessões WhatsApp...\n');

    const sessions = await prisma.whatsAppSession.findMany({
      orderBy: { createdAt: 'desc' },
    });

    if (sessions.length === 0) {
      console.log('❌ Nenhuma sessão WhatsApp encontrada no banco de dados.\n');
      console.log('📝 Para criar uma sessão, você pode:');
      console.log('   1. Usar a API POST /whatsapp com o corpo:');
      console.log('      {');
      console.log('        "name": "Minha Sessão",');
      console.log('        "phoneNumber": "5511999999999",');
      console.log('        "userId": "seu-user-id"');
      console.log('      }');
      console.log('\n   2. Ou executar este comando SQL:');
      console.log('      INSERT INTO "WhatsAppSession" ("sessionId", "name", "phoneNumber", "status", "isActive", "userId") ');
      console.log('      VALUES (\'whatsapp-\' || EXTRACT(EPOCH FROM NOW())::BIGINT, \'Teste Local\', \'5511999999999\', \'DISCONNECTED\', true, \'test-user-id\');');
    } else {
      console.log(`✅ ${sessions.length} sessão(ões) encontrada(s):\n`);
      sessions.forEach((session, index) => {
        console.log(`${index + 1}. ${session.name || 'Sem nome'}`);
        console.log(`   - Session ID: ${session.sessionId}`);
        console.log(`   - Telefone: ${session.phoneNumber || 'N/A'}`);
        console.log(`   - Status: ${session.status}`);
        console.log(`   - Ativa: ${session.isActive ? 'Sim' : 'Não'}`);
        console.log(`   - Última atualização: ${session.updatedAt.toLocaleString('pt-BR')}`);
        console.log('');
      });
    }

    console.log('\n📊 Resumo:');
    console.log(`   - Total de sessões: ${sessions.length}`);
    console.log(`   - Sessões ativas: ${sessions.filter((s) => s.isActive).length}`);
    console.log(`   - Sessões conectadas: ${sessions.filter((s) => s.status === 'CONNECTED').length}`);
    console.log(`   - Sessões desconectadas: ${sessions.filter((s) => s.status === 'DISCONNECTED').length}`);
  } catch (error) {
    console.error('❌ Erro ao verificar sessões:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkSessions();
