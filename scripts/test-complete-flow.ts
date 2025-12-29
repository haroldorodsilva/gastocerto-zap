#!/usr/bin/env ts-node

/**
 * Script para testar o fluxo completo de criação e ativação de sessão WhatsApp
 * 
 * Fluxo:
 * 1. Criar sessão no banco
 * 2. Ativar sessão (iniciar Baileys)
 * 3. Gerar QR code
 * 4. Aguardar leitura do QR
 * 5. Receber mensagens
 */

import { PrismaClient, SessionStatus } from '@prisma/client';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { WhatsAppSessionManager } from '../src/infrastructure/whatsapp/sessions/whatsapp-session-manager.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 Iniciando teste do fluxo completo...\n');

  // Bootstrap da aplicação NestJS
  const app = await NestFactory.createApplicationContext(AppModule);
  const sessionManager = app.get(WhatsAppSessionManager);
  const eventEmitter = app.get(EventEmitter2);

  const TEST_SESSION_ID = 'test-session-' + Date.now();
  const TEST_PHONE = '5566996285154';

  try {
    // 1. Criar sessão no banco
    console.log('📝 Passo 1: Criando sessão no banco...');
    const session = await prisma.whatsAppSession.create({
      data: {
        sessionId: TEST_SESSION_ID,
        phoneNumber: TEST_PHONE,
        status: SessionStatus.DISCONNECTED,
        isActive: false,
      },
    });
    console.log(`✅ Sessão criada: ${session.sessionId}\n`);

    // 2. Configurar listeners de eventos
    console.log('📡 Passo 2: Configurando listeners de eventos...');
    
    eventEmitter.on('session.qr', (data: { sessionId: string; qr: string }) => {
      console.log('\n📱 QR CODE GERADO:');
      console.log('SessionId:', data.sessionId);
      console.log('QR Code (primeiros 50 chars):', data.qr.substring(0, 50) + '...');
      console.log('QR Code length:', data.qr.length);
      console.log('\n💡 Use este QR code para conectar no WhatsApp Web\n');
    });

    eventEmitter.on('session.connected', (data: { sessionId: string }) => {
      console.log('\n✅ SESSÃO CONECTADA:', data.sessionId);
      console.log('🎉 WhatsApp autenticado com sucesso!\n');
    });

    eventEmitter.on('session.disconnected', (data: { sessionId: string; reason?: string }) => {
      console.log('\n📴 SESSÃO DESCONECTADA:', data.sessionId);
      if (data.reason) {
        console.log('Motivo:', data.reason);
      }
    });

    eventEmitter.on('whatsapp.message', (data: any) => {
      console.log('\n📨 MENSAGEM RECEBIDA:');
      console.log('From:', data.from);
      console.log('Message:', data.message);
      console.log('Type:', data.type);
    });

    eventEmitter.on('session.error', (data: { sessionId: string; error: Error }) => {
      console.error('\n❌ ERRO NA SESSÃO:', data.sessionId);
      console.error('Error:', data.error.message);
    });

    console.log('✅ Listeners configurados\n');

    // 3. Iniciar sessão (Baileys)
    console.log('🔌 Passo 3: Iniciando sessão (Baileys)...');
    await sessionManager.startSession(TEST_SESSION_ID);
    console.log('✅ Sessão iniciada, aguardando QR code...\n');

    // 4. Aguardar QR code estar disponível
    console.log('⏳ Aguardando QR code ser gerado...');
    let attempts = 0;
    const maxAttempts = 30;
    
    while (attempts < maxAttempts) {
      const qr = await sessionManager.getQRCode(TEST_SESSION_ID);
      if (qr) {
        console.log('✅ QR Code disponível!\n');
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
      process.stdout.write('.');
    }

    if (attempts >= maxAttempts) {
      throw new Error('Timeout: QR code não foi gerado');
    }

    // 5. Aguardar autenticação
    console.log('\n⏳ Aguardando leitura do QR code...');
    console.log('📱 Abra o WhatsApp no seu celular e escaneie o QR code');
    console.log('⏰ Aguardando até 60 segundos...\n');

    let connected = false;
    for (let i = 0; i < 60; i++) {
      if (sessionManager.isSessionConnected(TEST_SESSION_ID)) {
        connected = true;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Mostrar progresso
      if (i % 10 === 0 && i > 0) {
        console.log(`⏱️  ${i}s passados...`);
      }
    }

    if (connected) {
      console.log('\n✅ TESTE COMPLETO: Sessão conectada com sucesso!');
      console.log('🎉 Agora você pode receber mensagens');
      console.log('⏰ Mantendo sessão ativa por 2 minutos para receber mensagens...\n');
      
      // Manter ativo por 2 minutos para receber mensagens
      await new Promise(resolve => setTimeout(resolve, 120000));
    } else {
      console.log('\n⚠️  Timeout: QR code não foi escaneado em 60 segundos');
      console.log('💡 Tente novamente e escaneie o QR code mais rápido');
    }

  } catch (error) {
    console.error('\n❌ Erro durante o teste:', error);
    throw error;
  } finally {
    // Cleanup
    console.log('\n🧹 Limpando recursos...');
    try {
      await sessionManager.stopSession(TEST_SESSION_ID);
      await sessionManager.deleteSession(TEST_SESSION_ID);
      console.log('✅ Sessão removida');
    } catch (cleanupError) {
      console.error('⚠️  Erro durante cleanup:', cleanupError);
    }
    
    await prisma.$disconnect();
    await app.close();
    console.log('👋 Teste finalizado\n');
  }
}

main()
  .catch((error) => {
    console.error('💥 Erro fatal:', error);
    process.exit(1);
  });
