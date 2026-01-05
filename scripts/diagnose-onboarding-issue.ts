import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Script para diagnosticar problema do onboarding
 * 
 * Verificações:
 * 1. Verifica se existe usuário no UserCache com isActive=true
 * 2. Verifica se existe sessão de onboarding ativa (completed=false)
 * 3. Mostra informações do usuário e da sessão
 */

async function diagnoseOnboardingIssue() {
  console.log('\n========================================');
  console.log('🔍 DIAGNÓSTICO DE PROBLEMA DE ONBOARDING');
  console.log('========================================\n');

  try {
    // Solicitar telefone ou chatId
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
      console.log('❌ Uso: ts-node scripts/diagnose-onboarding-issue.ts <phoneNumber ou chatId>');
      console.log('\nExemplos:');
      console.log('  ts-node scripts/diagnose-onboarding-issue.ts 5566996285154');
      console.log('  ts-node scripts/diagnose-onboarding-issue.ts 707624962\n');
      process.exit(1);
    }

    const platformId = args[0];
    
    console.log(`📋 Buscando informações para: ${platformId}\n`);
    console.log('─'.repeat(80));

    // ====================================
    // 1. VERIFICAR USERCACHE
    // ====================================
    console.log('\n1️⃣ VERIFICANDO USERCACHE...\n');

    // Tentar buscar por phoneNumber (WhatsApp)
    let userCache = await prisma.userCache.findFirst({
      where: { phoneNumber: platformId },
    });

    // Se não encontrou, tentar por telegramId (Telegram)
    if (!userCache) {
      userCache = await prisma.userCache.findFirst({
        where: { telegramId: platformId },
      });
    }

    if (userCache) {
      console.log('✅ USUÁRIO ENCONTRADO NO USERCACHE:');
      console.log(`   ID: ${userCache.id}`);
      console.log(`   Nome: ${userCache.name}`);
      console.log(`   Email: ${userCache.email}`);
      console.log(`   Telefone: ${userCache.phoneNumber}`);
      console.log(`   GastoCertoId: ${userCache.gastoCertoId}`);
      console.log(`   Telegram ID: ${userCache.telegramId || 'N/A'}`);
      console.log(`   WhatsApp ID: ${userCache.whatsappId || 'N/A'}`);
      console.log(`   ❗ isActive: ${userCache.isActive ? '✅ SIM' : '❌ NÃO'}`);
      console.log(`   ❗ isBlocked: ${userCache.isBlocked ? '⛔ SIM' : '✅ NÃO'}`);
      console.log(`   hasActiveSubscription: ${userCache.hasActiveSubscription ? '✅ SIM' : '❌ NÃO'}`);
      console.log(`   Criado em: ${userCache.createdAt.toLocaleString('pt-BR')}`);
      console.log(`   Atualizado em: ${userCache.updatedAt.toLocaleString('pt-BR')}`);
    } else {
      console.log('❌ USUÁRIO NÃO ENCONTRADO NO USERCACHE');
    }

    console.log('\n' + '─'.repeat(80));

    // ====================================
    // 2. VERIFICAR ONBOARDING SESSION
    // ====================================
    console.log('\n2️⃣ VERIFICANDO ONBOARDING SESSION...\n');

    const onboardingSession = await prisma.onboardingSession.findFirst({
      where: {
        platformId,
        completed: false,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (onboardingSession) {
      console.log('⚠️ SESSÃO DE ONBOARDING ATIVA ENCONTRADA:');
      console.log(`   ID: ${onboardingSession.id}`);
      console.log(`   Platform ID: ${onboardingSession.platformId}`);
      console.log(`   Current Step: ${onboardingSession.currentStep}`);
      console.log(`   ❗ Completed: ${onboardingSession.completed ? '✅ SIM' : '❌ NÃO'}`);
      console.log(`   Attempts: ${onboardingSession.attempts}`);
      console.log(`   Criado em: ${onboardingSession.createdAt.toLocaleString('pt-BR')}`);
      console.log(`   Última mensagem: ${onboardingSession.lastMessageAt?.toLocaleString('pt-BR') || 'N/A'}`);
      console.log(`   Expira em: ${onboardingSession.expiresAt.toLocaleString('pt-BR')}`);
      
      const data = onboardingSession.data as any;
      if (data && Object.keys(data).length > 0) {
        console.log('\n   📝 Dados coletados:');
        if (data.name) console.log(`      Nome: ${data.name}`);
        if (data.email) console.log(`      Email: ${data.email}`);
        if (data.realPhoneNumber) console.log(`      Telefone Real: ${data.realPhoneNumber}`);
        if (data.platform) console.log(`      Plataforma: ${data.platform}`);
        if (data.verificationCode) console.log(`      Código Verificação: ${data.verificationCode}`);
      }
    } else {
      console.log('✅ NENHUMA SESSÃO DE ONBOARDING ATIVA');
    }

    console.log('\n' + '─'.repeat(80));

    // ====================================
    // 3. VERIFICAR HISTÓRICO DE SESSÕES
    // ====================================
    console.log('\n3️⃣ HISTÓRICO DE SESSÕES DE ONBOARDING...\n');

    const allSessions = await prisma.onboardingSession.findMany({
      where: { platformId },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    if (allSessions.length > 0) {
      console.log(`📋 Últimas ${allSessions.length} sessões:`);
      allSessions.forEach((session, index) => {
        console.log(`\n   ${index + 1}. Sessão ID: ${session.id}`);
        console.log(`      Step: ${session.currentStep}`);
        console.log(`      Completed: ${session.completed ? '✅' : '❌'}`);
        console.log(`      Criado: ${session.createdAt.toLocaleString('pt-BR')}`);
      });
    } else {
      console.log('📋 Nenhuma sessão de onboarding encontrada no histórico');
    }

    console.log('\n' + '─'.repeat(80));

    // ====================================
    // 4. DIAGNÓSTICO
    // ====================================
    console.log('\n4️⃣ DIAGNÓSTICO:\n');

    if (userCache && onboardingSession) {
      console.log('🔴 PROBLEMA IDENTIFICADO:');
      console.log('   ❌ Usuário existe no UserCache E tem sessão de onboarding ativa');
      console.log('   ❌ Isso explica por que está caindo no fluxo de onboarding\n');
      
      console.log('💡 CAUSA PROVÁVEL:');
      console.log('   - A sessão de onboarding não foi marcada como completed=true');
      console.log('   - O sistema verifica se existe sessão ativa (completed=false) ANTES de buscar o usuário');
      console.log('   - Por isso, mesmo tendo registro no banco, está entrando no onboarding\n');
      
      console.log('🔧 SOLUÇÃO:');
      console.log(`   Execute: DELETE FROM "OnboardingSession" WHERE "platformId" = '${platformId}' AND "completed" = false;`);
      console.log('   OU rode o script de correção que criaremos a seguir\n');
    } else if (userCache && !onboardingSession) {
      console.log('✅ USUÁRIO OK:');
      console.log('   ✅ Usuário existe no UserCache');
      console.log('   ✅ Não há sessão de onboarding ativa');
      console.log('   ✅ Deveria funcionar normalmente\n');
      
      if (!userCache.isActive) {
        console.log('⚠️ ATENÇÃO:');
        console.log('   ❗ isActive = false - Usuário pode estar inativo');
        console.log('   Isso pode fazer o sistema iniciar um fluxo de reativação\n');
      }
    } else if (!userCache && onboardingSession) {
      console.log('🔴 PROBLEMA IDENTIFICADO:');
      console.log('   ❌ Sessão de onboarding ativa sem usuário no cache');
      console.log('   ❌ Onboarding não foi concluído corretamente\n');
      
      console.log('🔧 SOLUÇÃO:');
      console.log('   - Complete o processo de onboarding');
      console.log('   - OU delete a sessão antiga e recomece\n');
    } else {
      console.log('ℹ️ USUÁRIO NOVO:');
      console.log('   ℹ️ Não existe registro no sistema');
      console.log('   ℹ️ Precisa completar o onboarding\n');
    }

    // ====================================
    // 5. ENDPOINT DE VALIDAÇÃO
    // ====================================
    console.log('\n' + '─'.repeat(80));
    console.log('\n5️⃣ ENDPOINT DE VALIDAÇÃO DE CÓDIGO:\n');
    console.log('📍 Endpoint backend: POST /external/users/auth-code/validate');
    console.log('📁 Arquivo: src/shared/gasto-certo-api.service.ts');
    console.log('🔧 Método: async validateAuthCode(data: ValidateAuthCodeDto)');
    console.log('\n💡 Este endpoint chama a API externa do GastoCerto para validar o código\n');

    console.log('─'.repeat(80));
    console.log('\n✅ Diagnóstico concluído!\n');

  } catch (error) {
    console.error('\n❌ Erro ao executar diagnóstico:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Executar
diagnoseOnboardingIssue();
