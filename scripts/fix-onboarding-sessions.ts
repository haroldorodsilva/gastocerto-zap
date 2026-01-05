import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Script para corrigir sessões de onboarding ativas de usuários que já estão registrados
 * 
 * O problema:
 * - Usuários com registro no UserCache têm sessões de onboarding com completed=false
 * - Isso faz o sistema entrar no fluxo de onboarding mesmo com usuário registrado
 * - MessageValidationService verifica onboarding ANTES de verificar se usuário existe
 * 
 * A solução:
 * - Identificar usuários no UserCache que têm sessões ativas de onboarding
 * - Marcar essas sessões como completed=true
 */

async function fixOnboardingSessions() {
  console.log('\n========================================');
  console.log('🔧 CORREÇÃO DE SESSÕES DE ONBOARDING');
  console.log('========================================\n');

  try {
    // 1. Buscar todas as sessões ativas de onboarding
    console.log('1️⃣ Buscando sessões ativas de onboarding...\n');
    
    const activeSessions = await prisma.onboardingSession.findMany({
      where: {
        completed: false,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    console.log(`📋 Encontradas ${activeSessions.length} sessões ativas\n`);

    if (activeSessions.length === 0) {
      console.log('✅ Nenhuma sessão ativa para corrigir!\n');
      return;
    }

    console.log('─'.repeat(80));

    // 2. Verificar quais têm usuário registrado
    console.log('\n2️⃣ Verificando usuários registrados...\n');

    let fixed = 0;
    let skipped = 0;

    for (const session of activeSessions) {
      const platformId = session.platformId;
      
      // Tentar buscar usuário por phoneNumber ou telegramId
      let userCache = await prisma.userCache.findFirst({
        where: {
          OR: [
            { phoneNumber: platformId },
            { telegramId: platformId },
            { whatsappId: platformId },
          ],
        },
      });

      if (userCache) {
        console.log(`⚠️ PROBLEMA ENCONTRADO:`);
        console.log(`   Platform ID: ${platformId}`);
        console.log(`   Usuário: ${userCache.name} (${userCache.email})`);
        console.log(`   Sessão ID: ${session.id}`);
        console.log(`   Step atual: ${session.currentStep}`);
        console.log(`   Criado em: ${session.createdAt.toLocaleString('pt-BR')}`);
        
        // Marcar sessão como completa
        await prisma.onboardingSession.update({
          where: { id: session.id },
          data: {
            completed: true,
            updatedAt: new Date(),
          },
        });

        console.log(`   ✅ Sessão marcada como completed=true\n`);
        fixed++;
      } else {
        console.log(`ℹ️ Sessão sem usuário registrado (OK):`);
        console.log(`   Platform ID: ${platformId}`);
        console.log(`   Step: ${session.currentStep}\n`);
        skipped++;
      }
    }

    console.log('─'.repeat(80));

    // 3. Resumo
    console.log('\n3️⃣ RESUMO:\n');
    console.log(`   ✅ Sessões corrigidas: ${fixed}`);
    console.log(`   ℹ️ Sessões válidas (não corrigidas): ${skipped}`);
    console.log(`   📊 Total processado: ${activeSessions.length}\n`);

    if (fixed > 0) {
      console.log('✅ Correção aplicada com sucesso!');
      console.log('💡 Os usuários afetados agora devem conseguir usar o sistema normalmente.\n');
    } else {
      console.log('✅ Nenhuma correção necessária!\n');
    }

  } catch (error) {
    console.error('\n❌ Erro ao executar correção:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Executar
fixOnboardingSessions();
