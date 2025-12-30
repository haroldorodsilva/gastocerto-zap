/* eslint-disable */
/**
 * Script de teste para os endpoints de administração do WhatsApp
 * 
 * Testa:
 * - Listagem de sessões
 * - Status detalhado
 * - Cache de chats e mensagens
 * - Sincronização de cache
 * - Atualização de configurações
 */

import axios, { AxiosInstance } from 'axios';

const API_URL = process.env.API_URL || 'http://localhost:4444';
const JWT_TOKEN = process.env.JWT_TOKEN || '';

if (!JWT_TOKEN) {
  console.error('❌ JWT_TOKEN environment variable is required');
  console.log('Usage: JWT_TOKEN=<your-token> ts-node scripts/test-whatsapp-admin.ts');
  process.exit(1);
}

const api: AxiosInstance = axios.create({
  baseURL: API_URL,
  headers: {
    'Authorization': `Bearer ${JWT_TOKEN}`,
    'Content-Type': 'application/json',
  },
});

// Cores para output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message: string, color: keyof typeof colors = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function section(title: string) {
  console.log('\n' + '='.repeat(60));
  log(title, 'bright');
  console.log('='.repeat(60));
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testListSessions() {
  section('📋 Teste 1: Listar Todas as Sessões');
  
  try {
    const response = await api.get('/whatsapp');
    log(`✅ Sucesso! ${response.data.length} sessão(ões) encontrada(s)`, 'green');
    
    if (response.data.length > 0) {
      const session = response.data[0];
      log(`\n📱 Primeira sessão:`, 'cyan');
      console.log(JSON.stringify(session, null, 2));
      return session.id; // Retorna ID para usar nos próximos testes
    } else {
      log('⚠️  Nenhuma sessão encontrada. Crie uma sessão primeiro.', 'yellow');
      return null;
    }
  } catch (error: any) {
    log(`❌ Erro: ${error.response?.data?.message || error.message}`, 'red');
    return null;
  }
}

async function testDetailedStatus(sessionId: string) {
  section('📊 Teste 2: Status Detalhado da Sessão');
  
  try {
    const response = await api.get(`/whatsapp/${sessionId}/status/detailed`);
    log('✅ Status detalhado obtido com sucesso!', 'green');
    console.log(JSON.stringify(response.data, null, 2));
    
    const { session, connection, cache } = response.data;
    log(`\n📌 Resumo:`, 'cyan');
    log(`   Status: ${session.status}`, connection.isConnected ? 'green' : 'red');
    log(`   Conectada: ${connection.isConnected ? 'Sim' : 'Não'}`, connection.isConnected ? 'green' : 'red');
    log(`   Chats em cache: ${cache.totalChats}`, 'blue');
    log(`   Mensagens em cache: ${cache.totalMessages}`, 'blue');
    log(`   Chats com mensagens não lidas: ${cache.chatsWithUnread}`, 'yellow');
    
    return connection.isConnected;
  } catch (error: any) {
    log(`❌ Erro: ${error.response?.data?.message || error.message}`, 'red');
    return false;
  }
}

async function testGetCachedChats(sessionId: string) {
  section('📦 Teste 3: Buscar Chats do Cache');
  
  try {
    const response = await api.get(`/whatsapp/${sessionId}/chats/cached?limit=10`);
    log(`✅ ${response.data.total} chat(s) encontrado(s) no cache`, 'green');
    log(`TTL: ${response.data.ttl} segundos (${response.data.ttl / 3600} horas)`, 'blue');
    
    if (response.data.chats.length > 0) {
      log('\n📱 Primeiros 3 chats:', 'cyan');
      response.data.chats.slice(0, 3).forEach((chat: any, index: number) => {
        console.log(`\n${index + 1}. ${chat.name}`);
        console.log(`   ID: ${chat.chatId}`);
        console.log(`   Grupo: ${chat.isGroup ? 'Sim' : 'Não'}`);
        console.log(`   Última mensagem: ${chat.lastMessageText || 'N/A'}`);
        console.log(`   Não lidas: ${chat.unreadCount}`);
      });
      
      return response.data.chats[0]?.chatId; // Retorna primeiro chatId
    }
    
    return null;
  } catch (error: any) {
    log(`❌ Erro: ${error.response?.data?.message || error.message}`, 'red');
    return null;
  }
}

async function testGetCachedMessages(sessionId: string, chatId: string) {
  section('💬 Teste 4: Buscar Mensagens do Cache');
  
  try {
    const response = await api.get(`/whatsapp/${sessionId}/chats/${encodeURIComponent(chatId)}/messages/cached?limit=5`);
    log(`✅ ${response.data.total} mensagem(ns) encontrada(s) no cache`, 'green');
    
    if (response.data.messages.length > 0) {
      log('\n📨 Últimas mensagens:', 'cyan');
      response.data.messages.forEach((msg: any, index: number) => {
        const direction = msg.fromMe ? '→' : '←';
        const time = new Date(msg.timestamp).toLocaleString('pt-BR');
        console.log(`${index + 1}. ${direction} ${msg.text || `[${msg.messageType}]`}`);
        console.log(`   De: ${msg.pushName || msg.from}`);
        console.log(`   Hora: ${time}`);
      });
    }
  } catch (error: any) {
    log(`❌ Erro: ${error.response?.data?.message || error.message}`, 'red');
  }
}

async function testSyncCache(sessionId: string) {
  section('🔄 Teste 5: Sincronizar Cache');
  
  try {
    log('Sincronizando chats...', 'yellow');
    const response = await api.post(`/whatsapp/${sessionId}/sync-cache`);
    log(`✅ Cache sincronizado com sucesso!`, 'green');
    log(`${response.data.cached} chat(s) salvos no cache`, 'blue');
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error: any) {
    log(`❌ Erro: ${error.response?.data?.message || error.message}`, 'red');
  }
}

async function testMarkChatAsRead(sessionId: string, chatId: string) {
  section('✅ Teste 6: Marcar Chat como Lido');
  
  try {
    const response = await api.post(`/whatsapp/${sessionId}/chats/${encodeURIComponent(chatId)}/mark-read`);
    log(`✅ Chat marcado como lido!`, 'green');
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error: any) {
    log(`❌ Erro: ${error.response?.data?.message || error.message}`, 'red');
  }
}

async function testUpdateSettings(sessionId: string) {
  section('⚙️  Teste 7: Atualizar Configurações');
  
  try {
    const settings = {
      name: 'WhatsApp Teste - ' + new Date().toISOString(),
      autoStart: true,
    };
    
    log('Atualizando configurações...', 'yellow');
    const response = await api.put(`/whatsapp/${sessionId}/settings`, settings);
    log(`✅ Configurações atualizadas!`, 'green');
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error: any) {
    log(`❌ Erro: ${error.response?.data?.message || error.message}`, 'red');
  }
}

async function testClearCache(sessionId: string) {
  section('🗑️  Teste 8: Limpar Cache');
  
  try {
    log('Limpando cache...', 'yellow');
    const response = await api.delete(`/whatsapp/${sessionId}/cache`);
    log(`✅ Cache limpo com sucesso!`, 'green');
    console.log(JSON.stringify(response.data, null, 2));
  } catch (error: any) {
    log(`❌ Erro: ${error.response?.data?.message || error.message}`, 'red');
  }
}

async function testGetContacts(sessionId: string) {
  section('👥 Teste 9: Listar Contatos');
  
  try {
    const response = await api.get(`/whatsapp/${sessionId}/contacts`);
    log(`✅ ${response.data.total} contato(s) encontrado(s)`, 'green');
    
    if (response.data.contacts.length > 0) {
      log('\n👤 Primeiros 5 contatos:', 'cyan');
      response.data.contacts.slice(0, 5).forEach((contact: any, index: number) => {
        console.log(`${index + 1}. ${contact.name || contact.id}`);
        console.log(`   ID: ${contact.id}`);
      });
    }
  } catch (error: any) {
    log(`❌ Erro: ${error.response?.data?.message || error.message}`, 'red');
  }
}

async function testGetChats(sessionId: string) {
  section('💬 Teste 10: Listar Chats (Direto do WhatsApp)');
  
  try {
    const response = await api.get(`/whatsapp/${sessionId}/chats`);
    log(`✅ ${response.data.total} chat(s) encontrado(s)`, 'green');
    
    if (response.data.chats.length > 0) {
      log('\n📱 Primeiros 3 chats:', 'cyan');
      response.data.chats.slice(0, 3).forEach((chat: any, index: number) => {
        console.log(`${index + 1}. ${chat.name}`);
        console.log(`   ID: ${chat.id}`);
        console.log(`   Grupo: ${chat.isGroup ? 'Sim' : 'Não'}`);
        console.log(`   Não lidas: ${chat.unreadCount || 0}`);
      });
    }
  } catch (error: any) {
    log(`❌ Erro: ${error.response?.data?.message || error.message}`, 'red');
  }
}

async function main() {
  log('\n🚀 Iniciando testes dos endpoints de administração do WhatsApp', 'bright');
  log(`API: ${API_URL}`, 'blue');
  
  try {
    // Teste 1: Listar sessões
    const sessionId = await testListSessions();
    if (!sessionId) {
      log('\n❌ Não foi possível continuar os testes sem uma sessão', 'red');
      return;
    }
    
    await sleep(1000);
    
    // Teste 2: Status detalhado
    const isConnected = await testDetailedStatus(sessionId);
    
    if (!isConnected) {
      log('\n⚠️  Sessão não está conectada. Alguns testes podem falhar.', 'yellow');
      log('Continuando com testes de cache...', 'yellow');
    }
    
    await sleep(1000);
    
    // Teste 3: Cache de chats
    const chatId = await testGetCachedChats(sessionId);
    
    await sleep(1000);
    
    // Teste 4: Cache de mensagens (se houver chatId)
    if (chatId) {
      await testGetCachedMessages(sessionId, chatId);
      await sleep(1000);
    }
    
    // Teste 5: Sincronizar cache (se conectada)
    if (isConnected) {
      await testSyncCache(sessionId);
      await sleep(1000);
    }
    
    // Teste 6: Marcar como lido (se houver chatId)
    if (chatId) {
      await testMarkChatAsRead(sessionId, chatId);
      await sleep(1000);
    }
    
    // Teste 7: Atualizar configurações
    await testUpdateSettings(sessionId);
    await sleep(1000);
    
    // Teste 8: Limpar cache
    await testClearCache(sessionId);
    await sleep(1000);
    
    // Teste 9: Listar contatos (se conectada)
    if (isConnected) {
      await testGetContacts(sessionId);
      await sleep(1000);
    }
    
    // Teste 10: Listar chats direto do WhatsApp (se conectada)
    if (isConnected) {
      await testGetChats(sessionId);
    }
    
    section('🎉 Testes Concluídos');
    log('Todos os testes foram executados!', 'green');
    
  } catch (error: any) {
    log(`\n❌ Erro fatal: ${error.message}`, 'red');
    console.error(error);
  }
}

// Executar testes
main().catch(console.error);
