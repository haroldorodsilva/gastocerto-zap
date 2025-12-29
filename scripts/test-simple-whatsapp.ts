#!/usr/bin/env ts-node
/**
 * Script de teste do simple-whatsapp-init.ts
 * 
 * Testa:
 * 1. Configuração da integração
 * 2. Verificação de sessão no banco
 * 3. Inicialização do WhatsApp
 * 4. Fluxo de eventos
 */

import { PrismaClient } from '@prisma/client';
import {
  setupWhatsAppIntegration,
  initializeSimpleWhatsApp,
  sendWhatsAppMessage,
  clearWhatsAppCredentials,
} from '../src/infrastructure/whatsapp/simple-whatsapp-init';
import { EventEmitter } from 'events';

const prisma = new PrismaClient();
const eventEmitter = new EventEmitter();

// Mock do handler de mensagens
const messageHandler = {
  handleIncomingMessage: async (payload: { sessionId: string; message: any }) => {
    console.log('\n📨 [TEST] Mensagem recebida pelo handler:');
    console.log('   SessionId:', payload.sessionId);
    console.log('   From:', payload.message.key.remoteJid);
    console.log('   MessageId:', payload.message.key.id);
    
    // Extrair texto da mensagem
    let messageText = '';
    if (payload.message.message?.conversation) {
      messageText = payload.message.message.conversation;
    } else if (payload.message.message?.extendedTextMessage?.text) {
      messageText = payload.message.message.extendedTextMessage.text;
    }
    
    console.log('   Texto:', messageText || '(sem texto)');
    console.log('   ✅ Handler processou a mensagem com sucesso\n');
  },
};

// Listeners de eventos
eventEmitter.on('session.qr', (data) => {
  console.log('\n🔔 [EVENT] session.qr recebido:');
  console.log('   SessionId:', data.sessionId);
  console.log('   QR Code gerado! (veja no terminal principal)\n');
});

eventEmitter.on('session.connected', (data) => {
  console.log('\n🔔 [EVENT] session.connected recebido:');
  console.log('   SessionId:', data.sessionId);
  console.log('   PhoneNumber:', data.phoneNumber);
  console.log('   Name:', data.name);
  console.log('   ✅ WhatsApp conectado com sucesso!\n');
});

eventEmitter.on('session.disconnected', (data) => {
  console.log('\n🔔 [EVENT] session.disconnected recebido:');
  console.log('   SessionId:', data.sessionId);
  console.log('   Reason:', data.reason);
  console.log('   ⚠️  WhatsApp desconectado\n');
});

eventEmitter.on('whatsapp.message', (payload) => {
  console.log('\n🔔 [EVENT] whatsapp.message recebido (do eventEmitter):');
  console.log('   SessionId:', payload.sessionId);
  console.log('   From:', payload.message.key.remoteJid);
  console.log('   ✅ Evento propagado corretamente!\n');
});

async function testIntegration() {
  console.log('\n' + '='.repeat(80));
  console.log('🧪 TESTE DO SIMPLE-WHATSAPP-INIT.TS');
  console.log('='.repeat(80) + '\n');

  try {
    // TESTE 1: Verificar sessão no banco
    console.log('📋 TESTE 1: Verificando sessão no banco de dados...');
    const session = await prisma.whatsAppSession.findUnique({
      where: { sessionId: 'whatsapp-simple-session' },
    });

    if (session) {
      console.log('   ✅ Sessão encontrada:');
      console.log('      - ID:', session.sessionId);
      console.log('      - Nome:', session.name);
      console.log('      - Status:', session.status);
      console.log('      - IsActive:', session.isActive);
      console.log('      - PhoneNumber:', session.phoneNumber || 'N/A');
      console.log('      - LastSeen:', session.lastSeen);
    } else {
      console.log('   ⚠️  Nenhuma sessão encontrada no banco');
      console.log('   ℹ️  Isso é normal se for a primeira vez');
    }

    // TESTE 2: Configurar integração
    console.log('\n📋 TESTE 2: Configurando integração...');
    setupWhatsAppIntegration(messageHandler, prisma, eventEmitter);
    console.log('   ✅ Integração configurada com sucesso');

    // TESTE 3: Verificar se pode inicializar (verificar isActive)
    console.log('\n📋 TESTE 3: Verificando se pode inicializar...');
    if (!session) {
      console.log('   ℹ️  Criando sessão inicial no banco...');
      await prisma.whatsAppSession.create({
        data: {
          sessionId: 'whatsapp-simple-session',
          name: 'WhatsApp Simple Test',
          phoneNumber: '',
          status: 'DISCONNECTED',
          creds: {},
          isActive: true,
        },
      });
      console.log('   ✅ Sessão criada com isActive=true');
    } else if (!session.isActive) {
      console.log('   ⚠️  Sessão existe mas está desativada (isActive=false)');
      console.log('   ℹ️  Para testar, ative a sessão com:');
      console.log('      UPDATE "WhatsAppSession" SET "isActive" = true WHERE "sessionId" = \'whatsapp-simple-session\';');
      console.log('\n   ❌ Abortando teste (sessão desativada)');
      await prisma.$disconnect();
      return;
    }

    // TESTE 4: Inicializar WhatsApp
    console.log('\n📋 TESTE 4: Inicializando WhatsApp...');
    console.log('   ⏳ Aguarde... (vai gerar QR Code se não houver credenciais)');
    console.log('   ℹ️  Pressione Ctrl+C para cancelar\n');

    const socket = await initializeSimpleWhatsApp();

    console.log('\n   ✅ WhatsApp inicializado com sucesso!');
    console.log('   Socket User:', socket.user);

    // TESTE 5: Aguardar eventos
    console.log('\n📋 TESTE 5: Aguardando eventos...');
    console.log('   ℹ️  Este teste vai ficar rodando indefinidamente');
    console.log('   ℹ️  Envie mensagens para o WhatsApp e veja os logs');
    console.log('   ℹ️  Pressione Ctrl+C para encerrar\n');

    // Manter o script rodando
    await new Promise((resolve) => {
      // Nunca resolve - mantém rodando até Ctrl+C
    });

  } catch (error) {
    console.error('\n❌ ERRO NO TESTE:', error instanceof Error ? error.message : String(error));
    console.error('   Stack:', error instanceof Error ? error.stack : 'N/A');
    await prisma.$disconnect();
    process.exit(1);
  }
}

// Tratamento de encerramento
process.on('SIGINT', async () => {
  console.log('\n\n🛑 Encerrando teste...');
  await prisma.$disconnect();
  console.log('✅ Teste encerrado\n');
  process.exit(0);
});

// Executar teste
testIntegration();
