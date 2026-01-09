import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔧 Gerenciando sessões Telegram...\n');

  try {
    // 1. Listar sessões atuais
    const sessions = await prisma.telegramSession.findMany({
      orderBy: { createdAt: 'desc' },
    });

    console.log(`📊 Sessões encontradas: ${sessions.length}\n`);

    sessions.forEach((session, idx) => {
      console.log(`${idx + 1}. ${session.name}`);
      console.log(`   ID: ${session.id}`);
      console.log(`   SessionId: ${session.sessionId}`);
      console.log(`   Token: ${session.token ? '***' + session.token.slice(-10) : 'NOT SET'}`);
      console.log(`   Status: ${session.status}`);
      console.log(`   isActive: ${session.isActive ? '✅' : '❌'}`);
      console.log('');
    });

    // 2. Desativar sessão de produção (evitar conflito)
    console.log('🛑 Desativando sessão de PRODUÇÃO para evitar conflito...');
    
    const prodSession = await prisma.telegramSession.findFirst({
      where: {
        name: 'Gasto Prod',
      },
    });

    if (prodSession) {
      await prisma.telegramSession.update({
        where: { id: prodSession.id },
        data: {
          isActive: false,
          status: 'DISCONNECTED',
        },
      });
      console.log('✅ Sessão de produção desativada!\n');
    }

    // 3. Criar/Atualizar sessão de DESENVOLVIMENTO
    console.log('🔧 Criando sessão de DESENVOLVIMENTO...');
    
    const devToken = '8537593919:AAHYQG2Jb_hUDbssDfqLoo4sBSUBPattwTo'; // Token do GastoCertoLocalbot
    
    const devSession = await prisma.telegramSession.findFirst({
      where: {
        name: 'Gasto Dev',
      },
    });

    if (devSession) {
      // Atualizar existente
      await prisma.telegramSession.update({
        where: { id: devSession.id },
        data: {
          token: devToken,
          isActive: true,
          status: 'INACTIVE',
        },
      });
      console.log('✅ Sessão de desenvolvimento atualizada!');
      console.log(`   ID: ${devSession.id}`);
    } else {
      // Criar nova
      const newSession = await prisma.telegramSession.create({
        data: {
          sessionId: `telegram-dev-${Date.now()}`,
          name: 'Gasto Dev',
          token: devToken,
          status: 'INACTIVE',
          isActive: true,
        },
      });
      console.log('✅ Sessão de desenvolvimento criada!');
      console.log(`   ID: ${newSession.id}`);
      console.log(`   SessionId: ${newSession.sessionId}`);
    }

    console.log('\n📋 Próximos passos:');
    console.log('   1. Reinicie o servidor: npm run start:dev');
    console.log('   2. A sessão de desenvolvimento será iniciada automaticamente');
    console.log('   3. Teste enviando mensagem para @GastoCertoLocalbot');
    console.log('\n⚠️  IMPORTANTE: A sessão de PRODUÇÃO foi desativada para evitar conflitos!');

  } catch (error) {
    console.error('❌ Erro:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
