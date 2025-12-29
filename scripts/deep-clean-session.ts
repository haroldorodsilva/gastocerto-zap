import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function deepClean() {
  console.log('🧹 Limpeza profunda de sessões WhatsApp...\n');

  // 1. Deletar todas as sessões WhatsApp
  const sessions = await prisma.whatsAppSession.findMany({
    where: {
      sessionId: {
        startsWith: 'whatsapp-'
      }
    }
  });

  console.log(`📋 Encontradas ${sessions.length} sessões WhatsApp`);

  for (const session of sessions) {
    console.log(`   🗑️  Deletando: ${session.sessionId}`);
    await prisma.whatsAppSession.delete({
      where: { id: session.id }
    });
  }

  // 2. Limpar sessões de onboarding WhatsApp
  const onboarding = await prisma.onboardingSession.deleteMany({
    where: {
      platformId: {
        contains: '@s.whatsapp.net'
      }
    }
  });
  console.log(`\n📝 Deletadas ${onboarding.count} sessões de onboarding WhatsApp`);

  // 3. Limpar pasta de auth states (se existir)
  const authStateDir = path.join(process.cwd(), 'auth_states');
  if (fs.existsSync(authStateDir)) {
    const files = fs.readdirSync(authStateDir);
    const whatsappFiles = files.filter(f => f.startsWith('whatsapp-'));
    
    for (const file of whatsappFiles) {
      fs.rmSync(path.join(authStateDir, file), { recursive: true, force: true });
    }
    console.log(`📁 Deletados ${whatsappFiles.length} arquivos de auth state`);
  } else {
    console.log(`📁 Pasta auth_states não existe (OK)`);
  }

  console.log('\n✅ Limpeza profunda concluída!');
  console.log('\n🚀 Próximos passos:');
  console.log('   1. npx ts-node scripts/create-test-session.ts');
  console.log('   2. npx ts-node scripts/activate-session.ts');
  console.log('   3. yarn start:dev');

  await prisma.$disconnect();
}

deepClean().catch((error) => {
  console.error('❌ Erro:', error);
  prisma.$disconnect();
  process.exit(1);
});
