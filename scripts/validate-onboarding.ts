import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function validateOnboarding() {
  console.log('🔍 Validando dados do onboarding...\n');

  try {
    // 1. Buscar todas as sessões de onboarding
    const sessions = await prisma.onboardingSession.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10, // Últimas 10 sessões
    });

    console.log(`📊 Total de sessões encontradas: ${sessions.length}\n`);
    console.log('─'.repeat(80));

    for (const session of sessions) {
      const data = session.data as any;
      
      console.log('\n📋 Sessão de Onboarding:');
      console.log(`   ID: ${session.id}`);
      console.log(`   Telefone: ${session.phoneNumber}`);
      console.log(`   Step Atual: ${session.currentStep}`);
      console.log(`   Completo: ${session.completed ? '✅ Sim' : '❌ Não'}`);
      console.log(`   Criado em: ${session.createdAt.toLocaleString('pt-BR')}`);
      console.log(`   Atualizado em: ${session.updatedAt.toLocaleString('pt-BR')}`);
      console.log(`   Expira em: ${session.expiresAt.toLocaleString('pt-BR')}`);
      console.log(`   Tentativas: ${session.attempts}`);
      
      if (data) {
        console.log('\n   📝 Dados coletados:');
        if (data.name) console.log(`      Nome: ${data.name}`);
        if (data.email) console.log(`      Email: ${data.email}`);
        if (data.realPhoneNumber) console.log(`      Telefone Real: ${data.realPhoneNumber}`);
        if (data.platform) console.log(`      Plataforma: ${data.platform}`);
        if (data.telegramId) console.log(`      Telegram ID: ${data.telegramId}`);
        if (data.verificationCode) console.log(`      Código Verificação: ${data.verificationCode}`);
      }
      
      console.log('\n' + '─'.repeat(80));
    }

    // 2. Buscar dados do UserCache
    console.log('\n\n🗄️ Validando UserCache...\n');
    console.log('─'.repeat(80));

    const userCaches = await prisma.userCache.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    console.log(`\n📊 Total de usuários em cache: ${userCaches.length}\n`);

    for (const user of userCaches) {
      console.log('\n👤 Usuário em Cache:');
      console.log(`   ID: ${user.id}`);
      console.log(`   Telefone: ${user.phoneNumber}`);
      console.log(`   Nome: ${user.name}`);
      console.log(`   Email: ${user.email}`);
      console.log(`   Telegram ID: ${user.telegramId || 'N/A'}`);
      console.log(`   WhatsApp ID: ${user.whatsappId || 'N/A'}`);
      console.log(`   Gasto Certo ID: ${user.gastoCertoId}`);
      console.log(`   Assinatura Ativa: ${user.hasActiveSubscription ? '✅ Sim' : '❌ Não'}`);
      console.log(`   Última sync: ${user.lastSyncAt ? user.lastSyncAt.toLocaleString('pt-BR') : 'Nunca'}`);
      console.log(`   Criado em: ${user.createdAt.toLocaleString('pt-BR')}`);
      console.log('\n' + '─'.repeat(80));
    }

    // 3. Validações específicas
    console.log('\n\n✅ Validações:\n');

    // Sessões completas
    const completedSessions = sessions.filter(s => s.completed);
    console.log(`✓ Sessões completadas: ${completedSessions.length}/${sessions.length}`);

    // Emails em minúsculo
    const emailsWithUpperCase = userCaches.filter(u => 
      u.email && u.email !== u.email.toLowerCase()
    );
    if (emailsWithUpperCase.length > 0) {
      console.log(`❌ ALERTA: ${emailsWithUpperCase.length} emails com letras maiúsculas:`);
      emailsWithUpperCase.forEach(u => {
        console.log(`   - ${u.email} (deveria ser: ${u.email.toLowerCase()})`);
      });
    } else {
      console.log('✓ Todos os emails estão em minúsculo');
    }

    // Telefones válidos
    const invalidPhones = userCaches.filter(u => {
      if (!u.phoneNumber) return false;
      const digits = u.phoneNumber.replace(/\D/g, '');
      return digits.length < 10 || digits.length > 11;
    });
    if (invalidPhones.length > 0) {
      console.log(`❌ ALERTA: ${invalidPhones.length} telefones inválidos:`);
      invalidPhones.forEach(u => {
        console.log(`   - ${u.phoneNumber} (${u.phoneNumber.replace(/\D/g, '').length} dígitos)`);
      });
    } else {
      console.log('✓ Todos os telefones são válidos');
    }

    // Sincronização com API
    const syncedUsers = userCaches.filter(u => u.gastoCertoId);
    console.log(`✓ Usuários sincronizados com API: ${syncedUsers.length}/${userCaches.length}`);

    // Sessões expiradas
    const now = new Date();
    const expiredSessions = sessions.filter(s => s.expiresAt < now && !s.completed);
    if (expiredSessions.length > 0) {
      console.log(`⚠️ Sessões expiradas (não completadas): ${expiredSessions.length}`);
    }

    // 4. Estatísticas por step
    console.log('\n\n📊 Estatísticas por Step:\n');
    const stepCounts = sessions.reduce((acc, s) => {
      acc[s.currentStep] = (acc[s.currentStep] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    Object.entries(stepCounts).forEach(([step, count]) => {
      console.log(`   ${step}: ${count}`);
    });

    console.log('\n✅ Validação concluída!\n');

  } catch (error) {
    console.error('❌ Erro ao validar dados:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Executar validação
validateOnboarding()
  .then(() => {
    console.log('🎉 Script executado com sucesso!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Erro fatal:', error);
    process.exit(1);
  });
