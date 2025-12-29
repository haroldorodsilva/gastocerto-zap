import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkSessions() {
  console.log('🔍 Verificando sessões WhatsApp...\n');

  const sessions = await prisma.whatsAppSession.findMany({
    select: {
      sessionId: true,
      name: true,
      status: true,
      phoneNumber: true,
      creds: true,
      lastConnected: true,
      createdAt: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
  });

  if (sessions.length === 0) {
    console.log('❌ Nenhuma sessão encontrada no banco');
    return;
  }

  console.log(`✅ Encontradas ${sessions.length} sessões:\n`);

  sessions.forEach((session, index) => {
    console.log(`${index + 1}. Session ID: ${session.sessionId}`);
    console.log(`   Nome: ${session.name}`);
    console.log(`   Status: ${session.status}`);
    console.log(`   Phone: ${session.phoneNumber || 'Não conectado'}`);
    console.log(`   Tem creds: ${session.creds ? 'SIM ✅' : 'NÃO ❌'}`);
    console.log(`   Last Connected: ${session.lastConnected || 'Nunca'}`);
    console.log(`   Created: ${session.createdAt}`);
    console.log('');
  });

  // Verificar especificamente as que deveriam auto-restore
  const shouldRestore = sessions.filter(
    (s) => s.status === 'CONNECTED' && s.creds !== null,
  );

  console.log('\n📊 Análise:');
  console.log(`   Total de sessões: ${sessions.length}`);
  console.log(
    `   Com status CONNECTED: ${sessions.filter((s) => s.status === 'CONNECTED').length}`,
  );
  console.log(
    `   Com credenciais salvas: ${sessions.filter((s) => s.creds !== null).length}`,
  );
  console.log(
    `   ✅ Prontas para auto-restore: ${shouldRestore.length}`,
  );

  if (shouldRestore.length === 0) {
    console.log('\n⚠️  PROBLEMA IDENTIFICADO:');
    console.log('   Nenhuma sessão tem status CONNECTED + credenciais salvas');
    console.log('   Por isso o auto-restore encontrou 0 sessões');
    console.log('\n💡 SOLUÇÃO:');
    console.log(
      '   1. Ative uma sessão via API: POST /whatsapp/:id/activate',
    );
    console.log('   2. Escaneie o QR code no celular');
    console.log(
      '   3. Aguarde o log: 💾 Credentials saved to database',
    );
    console.log('   4. A sessão ficará com status CONNECTED + creds salvas');
    console.log(
      '   5. No próximo restart, ela será restaurada automaticamente',
    );
  }

  await prisma.$disconnect();
}

checkSessions().catch((error) => {
  console.error('❌ Erro:', error);
  process.exit(1);
});
