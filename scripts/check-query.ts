import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkQuery() {
  console.log('🔍 Executando query exata do SessionManager...\n');
  
  const sessions = await prisma.whatsAppSession.findMany({
    where: {
      isActive: true,
      status: {
        in: ['CONNECTED', 'CONNECTING'],
      },
    },
  });

  console.log(`✅ Resultado: ${sessions.length} sessão(ões) encontrada(s)\n`);
  
  sessions.forEach((s, i) => {
    console.log(`${i+1}. ${s.name}`);
    console.log(`   - Status: ${s.status}`);
    console.log(`   - isActive: ${s.isActive}`);
    console.log(`   - Session ID: ${s.sessionId}\n`);
  });

  // Buscar TODAS as sessões
  const all = await prisma.whatsAppSession.findMany();
  console.log(`\n📊 Total de sessões no banco: ${all.length}`);
  all.forEach((s) => {
    console.log(`   - ${s.name}: status="${s.status}", isActive=${s.isActive}`);
  });

  await prisma.$disconnect();
}

checkQuery();
