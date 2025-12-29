#!/usr/bin/env ts-node

/**
 * Cliente WebSocket de exemplo para testar o recebimento de QR codes
 * 
 * Este script demonstra como conectar ao WebSocket e receber eventos
 * de QR code, conexão, desconexão e mensagens.
 */

import { io, Socket } from 'socket.io-client';

// Configuração
const WS_URL = process.env.WS_URL || 'http://localhost:3000';
const JWT_TOKEN = process.env.JWT_TOKEN || 'your-jwt-token-here';
const SESSION_ID = process.env.SESSION_ID || 'test-session';

console.log('🚀 Iniciando cliente WebSocket...\n');
console.log('📡 URL:', WS_URL + '/ws');
console.log('🔑 Token:', JWT_TOKEN ? 'Configurado' : '⚠️  NÃO configurado');
console.log('📱 SessionId:', SESSION_ID);
console.log('');

// Criar conexão WebSocket
const socket: Socket = io(WS_URL + '/ws', {
  transports: ['websocket'],
  auth: {
    token: JWT_TOKEN,
  },
});

// Event handlers
socket.on('connect', () => {
  console.log('✅ Conectado ao WebSocket');
  console.log('🆔 Client ID:', socket.id);
  console.log('');

  // Inscrever-se nos eventos da sessão
  console.log('📡 Inscrevendo-se na sessão:', SESSION_ID);
  socket.emit('subscribe:session', { sessionId: SESSION_ID });
});

socket.on('connected', (data: any) => {
  console.log('🎉 Autenticado no servidor:');
  console.log('   User:', data.user);
  console.log('');
});

socket.on('subscribed', (data: any) => {
  console.log('✅ Inscrito na sessão:', data.sessionId);
  console.log('');
  console.log('⏳ Aguardando eventos...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
});

// QR Code events
socket.on('qr', (data: any) => {
  console.log('\n📱 QR CODE RECEBIDO:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('SessionId:', data.sessionId);
  console.log('Timestamp:', data.timestamp);
  console.log('QR Code (primeiros 100 chars):');
  console.log(data.qr.substring(0, 100) + '...');
  console.log('QR Code length:', data.qr.length);
  console.log('');
  console.log('💡 Escaneie este QR code no WhatsApp para conectar');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
});

socket.on('qr:expired', (data: any) => {
  console.log('\n⏰ QR CODE EXPIRADO:');
  console.log('SessionId:', data.sessionId);
  console.log('Timestamp:', data.timestamp);
  console.log('💡 Um novo QR code será gerado automaticamente');
  console.log('');
});

// Session events
socket.on('session:started', (data: any) => {
  console.log('\n🚀 SESSÃO INICIADA:');
  console.log('SessionId:', data.sessionId);
  console.log('Timestamp:', data.timestamp);
  console.log('');
});

socket.on('session:connected', (data: any) => {
  console.log('\n✅ SESSÃO CONECTADA:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('SessionId:', data.sessionId);
  console.log('Timestamp:', data.timestamp);
  console.log('🎉 WhatsApp autenticado com sucesso!');
  console.log('📨 Aguardando mensagens...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
});

socket.on('session:disconnected', (data: any) => {
  console.log('\n📴 SESSÃO DESCONECTADA:');
  console.log('SessionId:', data.sessionId);
  console.log('Reason:', data.reason || 'N/A');
  console.log('Timestamp:', data.timestamp);
  console.log('');
});

socket.on('session:stopped', (data: any) => {
  console.log('\n🔴 SESSÃO PARADA:');
  console.log('SessionId:', data.sessionId);
  console.log('Timestamp:', data.timestamp);
  console.log('');
});

socket.on('session:update', (data: any) => {
  console.log('\n🔄 ATUALIZAÇÃO DA SESSÃO:');
  console.log('SessionId:', data.sessionId);
  console.log('Update:', JSON.stringify(data.update, null, 2));
  console.log('Timestamp:', data.timestamp);
  console.log('');
});

// Message events
socket.on('session:message', (data: any) => {
  console.log('\n📨 MENSAGEM RECEBIDA:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('SessionId:', data.sessionId);
  console.log('From:', data.message.from);
  console.log('Message:', data.message.message || data.message.body);
  console.log('Type:', data.message.type);
  console.log('Timestamp:', data.timestamp);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
});

// Error events
socket.on('session:error', (data: any) => {
  console.error('\n❌ ERRO NA SESSÃO:');
  console.error('SessionId:', data.sessionId);
  console.error('Error:', data.error);
  console.error('Timestamp:', data.timestamp);
  console.error('');
});

socket.on('session:auth:corrupted', (data: any) => {
  console.error('\n🔐 AUTENTICAÇÃO CORROMPIDA:');
  console.error('SessionId:', data.sessionId);
  console.error('Message:', data.message);
  console.error('Timestamp:', data.timestamp);
  console.error('💡 Você pode precisar resetar as credenciais');
  console.error('');
});

socket.on('session:error:515', (data: any) => {
  console.warn('\n⚠️  ERRO 515:');
  console.warn('SessionId:', data.sessionId);
  console.warn('Message:', data.message);
  console.warn('Timestamp:', data.timestamp);
  console.warn('');
});

socket.on('error', (error: any) => {
  console.error('\n❌ ERRO DO WEBSOCKET:', error);
  console.error('');
});

socket.on('disconnect', (reason: string) => {
  console.log('\n📴 Desconectado do WebSocket');
  console.log('Reason:', reason);
  console.log('');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Encerrando cliente...');
  socket.disconnect();
  process.exit(0);
});

console.log('💡 Pressione Ctrl+C para sair');
console.log('');
