import { Logger } from '@nestjs/common';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  WASocket,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { SessionStatus } from '@prisma/client';
import * as path from 'path';
import * as fs from 'fs';
import * as qrcode from 'qrcode-terminal';
import { SESSION_EVENTS } from '@infrastructure/messaging/messaging-events.constants';

/**
 * Implementação SIMPLES do WhatsApp integrada com a API
 * - Salva credenciais em .auth_info
 * - Salva sessão no banco de dados
 * - Processa mensagens através do handler existente
 * - Envia respostas de volta aos usuários
 */

const logger = new Logger('SimpleWhatsApp');

// Adicionar método trace para compatibilidade com Baileys
const baileysLogger: any = {
  fatal: (...args: any[]) => logger.error(args.join(' ')),
  error: (...args: any[]) => logger.error(args.join(' ')),
  warn: (...args: any[]) => logger.warn(args.join(' ')),
  info: (...args: any[]) => logger.log(args.join(' ')),
  debug: (...args: any[]) => logger.debug(args.join(' ')),
  trace: (...args: any[]) => logger.verbose(args.join(' ')),
  child: () => baileysLogger,
};

/**
 * Encapsula todo o estado mutável do WhatsApp simples.
 * Substitui variáveis globais soltas para melhorar testabilidade e lifecycle.
 */
export class WhatsAppSocketState {
  socket: WASocket | null = null;
  messageHandler: any = null;
  prisma: any = null;
  eventEmitter: any = null;

  reset(): void {
    this.socket = null;
    this.messageHandler = null;
    this.prisma = null;
    this.eventEmitter = null;
  }
}

/** Singleton do estado — importado pelo WhatsAppIntegrationService e testes */
export const whatsAppState = new WhatsAppSocketState();

const SESSION_ID: string = 'whatsapp-simple-session';
const TEST_PHONE_NUMBER = process.env.TEST_PHONE_NUMBER || '';

// Diretório onde as credenciais serão salvas
const AUTH_DIR = path.join(process.cwd(), '.auth_info');

/**
 * Configura os serviços necessários para integração
 */
export function setupWhatsAppIntegration(handler: any, prisma: any, emitter?: any) {
  whatsAppState.messageHandler = handler;
  whatsAppState.prisma = prisma;
  whatsAppState.eventEmitter = emitter;
  logger.log('✅ Integração configurada com handler e Prisma');
}

/**
 * Verifica se a sessão está ativa no banco de dados
 */
async function isSessionActive(): Promise<boolean> {
  if (!whatsAppState.prisma) {
    logger.warn('⚠️  PrismaService não disponível para verificar sessão');
    return false;
  }

  try {
    const session = await whatsAppState.prisma.whatsAppSession.findUnique({
      where: { sessionId: SESSION_ID },
      select: { isActive: true },
    });

    if (session?.isActive === true) {
      logger.log('✅ Sessão ativa no banco de dados');
      return true;
    } else {
      logger.warn('⚠️  Sessão não está ativa no banco de dados');
      return false;
    }
  } catch (error) {
    logger.error('❌ Erro ao verificar sessão ativa:', error);
    return false;
  }
}

/**
 * Envia mensagem via WhatsApp
 */
export async function sendWhatsAppMessage(to: string, text: string): Promise<boolean> {
  if (!whatsAppState.socket) {
    logger.error('❌ Socket não disponível para envio');
    return false;
  }

  try {
    // Formatar número no padrão do WhatsApp
    const jid = to.includes('@') ? to : `${to.replace(/\D/g, '')}@s.whatsapp.net`;

    await whatsAppState.socket.sendMessage(jid, { text });
    logger.log(`✅ Mensagem enviada para ${to}`);
    return true;
  } catch (error) {
    logger.error(`❌ Erro ao enviar mensagem para ${to}:`, error.message);
    return false;
  }
}

/**
 * Para a conexão do WhatsApp
 */
export async function stopWhatsAppConnection(): Promise<void> {
  if (!whatsAppState.socket) {
    logger.warn('⚠️  Socket não está conectado');
    return;
  }

  try {
    logger.log('🛑 Encerrando conexão do WhatsApp...');
    await whatsAppState.socket.logout();
    whatsAppState.socket = null;
    logger.log('✅ Conexão encerrada com sucesso');
  } catch (error) {
    logger.error('❌ Erro ao encerrar conexão:', error.message);
    whatsAppState.socket = null;
  }
}

/**
 * Salva sessão no banco de dados
 */
async function saveSessionToDatabase(userId: string, name: string, status: SessionStatus) {
  if (!whatsAppState.prisma) {
    logger.warn('⚠️ Prisma não disponível, não é possível salvar sessão');
    return;
  }

  try {
    const existingSession = await whatsAppState.prisma.whatsAppSession.findUnique({
      where: { sessionId: SESSION_ID },
    });

    if (existingSession) {
      await whatsAppState.prisma.whatsAppSession.update({
        where: { sessionId: SESSION_ID },
        data: {
          status,
          lastConnected: new Date(),
          phoneNumber: userId,
        },
      });
      logger.log(`✅ Sessão ${SESSION_ID} atualizada no banco`);
    } else {
      await whatsAppState.prisma.whatsAppSession.create({
        data: {
          sessionId: SESSION_ID,
          name: name || 'WhatsApp Simple',
          phoneNumber: userId,
          status,
          lastConnected: new Date(),
        },
      });
      logger.log(`✅ Nova sessão ${SESSION_ID} criada no banco`);
    }
  } catch (error) {
    logger.error(`❌ Erro ao salvar sessão no banco:`, error.message);
  }
}

export async function initializeSimpleWhatsApp(skipActiveCheck = false): Promise<WASocket> {
  logger.log('🚀 Iniciando WhatsApp simples...');

  // Verificar se a sessão está ativa no banco (apenas no auto-restore)
  if (!skipActiveCheck) {
    const active = await isSessionActive();
    if (!active) {
      logger.error('❌ Sessão não está ativa no banco de dados - Abortando inicialização');
      throw new Error('Session not active in database');
    }
  } else {
    logger.log('ℹ️  Pulando verificação de sessão ativa (ativação manual)');
  }

  // Criar diretório de autenticação se não existir
  if (!fs.existsSync(AUTH_DIR)) {
    logger.log(`📁 Criando diretório de autenticação: ${AUTH_DIR}`);
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  } else {
    logger.log(`📁 Diretório de autenticação existe: ${AUTH_DIR}`);
  }

  // Verificar se já existe credencial salva
  const credsFile = path.join(AUTH_DIR, 'creds.json');
  const hasCredentials = fs.existsSync(credsFile);

  if (hasCredentials) {
    logger.log('🔑 Credenciais encontradas! Tentando restaurar sessão...');
  } else {
    logger.log('🆕 Nenhuma credencial encontrada. Será necessário escanear QR Code.');
  }

  try {
    // Carregar versão mais recente do Baileys
    const { version, isLatest } = await fetchLatestBaileysVersion();
    logger.log(`📱 Baileys version: ${version.join('.')} (latest: ${isLatest})`);

    // Carregar/criar estado de autenticação
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    // Criar socket do WhatsApp
    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
      },
      logger: baileysLogger,
      browser: ['ZAP', 'Chrome', '10.0.0'],
      markOnlineOnConnect: true,
      syncFullHistory: false, // Não sincronizar histórico completo (melhora performance)
      printQRInTerminal: false, // Desabilitar QR automático (já fazemos manual)
    });

    // Armazenar socket no state holder para envio de mensagens
    whatsAppState.socket = sock;

    // Keep-alive: Mostrar que o app está ativo a cada 30 segundos
    setInterval(() => {
      if (sock.user) {
        const userName = sock.user.name || sock.user.verifiedName || 'WhatsApp';
        logger.debug(`💚 App ativo - Conectado como ${userName} (${sock.user.id})`);
      }
    }, 30000);

    // ============================================
    // EVENT: Atualização de credenciais
    // ============================================
    sock.ev.on('creds.update', saveCreds);

    // ============================================
    // EVENT: Atualização de conexão
    // ============================================
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // ✅ Mostrar QR Code no terminal
      if (qr) {
        logger.log('\n' + '='.repeat(80));
        logger.log('📱 QR CODE GERADO! Escaneie com seu WhatsApp:');
        logger.log('='.repeat(80));
        qrcode.generate(qr, { small: true });
        logger.log('='.repeat(80) + '\n');

        // 📡 Emitir evento para WebSocket
        if (whatsAppState.eventEmitter) {
          whatsAppState.eventEmitter.emit(SESSION_EVENTS.QR, {
            sessionId: SESSION_ID,
            qr: qr,
          });
          logger.log('📡 Evento session.qr emitido para WebSocket');
        }
      }

      if (connection === 'close') {
        const shouldReconnect =
          (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;

        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        logger.warn(`❌ Conexão fechada. Status: ${statusCode}`);
        logger.warn(`Reason: ${lastDisconnect?.error?.message || 'Unknown'}`);

        // 📡 Emitir evento de desconexão
        if (whatsAppState.eventEmitter) {
          whatsAppState.eventEmitter.emit(SESSION_EVENTS.DISCONNECTED, {
            sessionId: SESSION_ID,
            reason: lastDisconnect?.error?.message || 'Unknown',
          });
        }

        if (shouldReconnect) {
          logger.log('🔄 Reconectando...');
          // Reconectar após 3 segundos
          setTimeout(() => initializeSimpleWhatsApp(), 3000);
        } else {
          logger.error('❌ Deslogado. Remova .auth_info e reinicie para novo QR Code.');
        }
      } else if (connection === 'open') {
        const now = new Date().toISOString();
        const userName = sock.user?.name || sock.user?.verifiedName || 'WhatsApp';
        logger.log(`\n${'🎉'.repeat(40)}`);
        logger.log(`✅ [${now}] CONECTADO AO WHATSAPP COM SUCESSO!`);
        logger.log(`📱 ID: ${sock.user?.id}`);
        logger.log(`👤 Nome: ${userName}`);
        logger.log(`🔋 Status: ATIVO e aguardando mensagens...`);
        logger.log(`${'🎉'.repeat(40)}\n`);

        // Salvar sessão no banco de dados
        if (sock.user?.id) {
          await saveSessionToDatabase(sock.user.id, userName, SessionStatus.CONNECTED);
        }

        // 📡 Emitir evento de conexão
        if (whatsAppState.eventEmitter) {
          whatsAppState.eventEmitter.emit(SESSION_EVENTS.CONNECTED, {
            sessionId: SESSION_ID,
            phoneNumber: sock.user?.id,
            name: sock.user?.name,
          });
        }
      } else if (connection === 'connecting') {
        logger.log(`🔄 [${new Date().toISOString()}] Conectando...`);
      }
    });

    // ============================================
    // EVENT: Mensagens recebidas (PRINCIPAL)
    // ============================================
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      const timestamp = new Date().toISOString();
      logger.log(`\n${'='.repeat(80)}`);
      logger.log(`📨 [${timestamp}] Nova mensagem recebida! (type: ${type})`);
      logger.log(`📊 Total de mensagens no batch: ${messages.length}`);

      for (const msg of messages) {
        // Log COMPLETO da mensagem para debug
        logger.log(`\n🔍 MENSAGEM COMPLETA:`);
        logger.log(
          JSON.stringify(
            {
              key: msg.key,
              messageTimestamp: msg.messageTimestamp,
              pushName: msg.pushName,
              hasMessage: !!msg.message,
              messageType: msg.message ? Object.keys(msg.message)[0] : 'none',
            },
            null,
            2,
          ),
        );

        // Informações básicas
        logger.log(`\n📱 ID: ${msg.key.id}`);
        logger.log(`👤 From: ${msg.key.remoteJid}`);
        logger.log(
          `📅 Timestamp: ${new Date((msg.messageTimestamp as number) * 1000).toISOString()}`,
        );
        logger.log(`📝 FromMe: ${msg.key.fromMe}`);
        logger.log(`🔢 Participant: ${msg.key.participant || 'N/A'}`);

        // Conteúdo da mensagem - TODOS OS TIPOS
        if (msg.message?.conversation) {
          logger.log(`💬 [CONVERSATION] Texto: "${msg.message.conversation}"`);
        } else if (msg.message?.extendedTextMessage?.text) {
          logger.log(`💬 [EXTENDED] Texto: "${msg.message.extendedTextMessage.text}"`);
          if (msg.message.extendedTextMessage.contextInfo) {
            logger.log(`🔗 Contexto: Resposta ou menção`);
          }
        } else if (msg.message?.imageMessage) {
          logger.log(`🖼️ [IMAGE] Imagem recebida`);
          if (msg.message.imageMessage.caption) {
            logger.log(`   Caption: "${msg.message.imageMessage.caption}"`);
          }
        } else if (msg.message?.videoMessage) {
          logger.log(`🎥 [VIDEO] Vídeo recebido`);
          if (msg.message.videoMessage.caption) {
            logger.log(`   Caption: "${msg.message.videoMessage.caption}"`);
          }
        } else if (msg.message?.documentMessage) {
          logger.log(
            `📎 [DOCUMENT] Documento: ${msg.message.documentMessage.fileName || 'sem nome'}`,
          );
        } else if (msg.message?.audioMessage) {
          logger.log(`🎵 [AUDIO] Áudio recebido (${msg.message.audioMessage.seconds || 0}s)`);
        } else if (msg.message?.stickerMessage) {
          logger.log(`😀 [STICKER] Sticker recebido`);
        } else if (msg.message?.contactMessage) {
          logger.log(`👤 [CONTACT] Contato compartilhado`);
        } else if (msg.message?.locationMessage) {
          logger.log(`📍 [LOCATION] Localização compartilhada`);
        } else if (msg.message?.protocolMessage) {
          logger.log(`🔄 [PROTOCOL] Mensagem de protocolo: ${msg.message.protocolMessage.type}`);
        } else if (msg.message) {
          const msgTypes = Object.keys(msg.message);
          logger.log(`❓ [${msgTypes.join(', ')}] Tipo desconhecido`);
          logger.log(`📦 Conteúdo completo: ${JSON.stringify(msg.message, null, 2)}`);
        } else {
          logger.log(`⚠️ Mensagem sem conteúdo (possivelmente notificação)`);
        }

        // Informações adicionais
        if (msg.pushName) {
          logger.log(`👤 Nome do remetente: ${msg.pushName}`);
        }

        // ✨ INTEGRAÇÃO COM O SISTEMA EXISTENTE - Enviar para processamento
        if (whatsAppState.messageHandler && msg.key.remoteJid && !msg.key.fromMe) {
          try {
            // Filtrar por número de teste se configurado
            if (TEST_PHONE_NUMBER) {
              const phoneNumber = msg.key.remoteJid.replace('@s.whatsapp.net', '');
              if (phoneNumber !== TEST_PHONE_NUMBER) {
                logger.log(
                  `⏭️  Mensagem ignorada - Número ${phoneNumber} não é o número de teste (${TEST_PHONE_NUMBER})`,
                );
                return;
              }
              logger.log(`✅ Mensagem do número de teste - Processando`);
            }

            logger.log(`🔄 Processando mensagem através do handler...`);

            // Emitir evento para o sistema processar
            await whatsAppState.messageHandler.handleIncomingMessage({
              sessionId: SESSION_ID,
              message: msg,
            });

            logger.log(`✅ Mensagem enviada para processamento`);
          } catch (error) {
            logger.error(`❌ Erro ao processar mensagem:`, error);
          }
        }

        // Marcar como lida (apenas mensagens de outras pessoas)
        if (!msg.key.fromMe && msg.key.remoteJid && msg.message) {
          try {
            await sock.readMessages([msg.key]);
            logger.log(`✅ Mensagem marcada como lida`);
          } catch (error) {
            logger.warn(`⚠️ Não foi possível marcar como lida: ${error.message}`);
          }
        }
      }

      logger.log(`${'='.repeat(80)}\n`);
    });

    // ============================================
    // EVENT: Mensagens atualizadas (status, reações, etc)
    // ============================================
    sock.ev.on('messages.update', (updates) => {
      for (const update of updates) {
        logger.log(`\n🔄 Mensagem atualizada:`);
        logger.log(`📱 ID: ${update.key.id}`);
        if (update.update.status) {
          logger.log(`📊 Status: ${update.update.status}`);
        }
        if (update.update.reactions) {
          logger.log(`😀 Reações: ${JSON.stringify(update.update.reactions)}`);
        }
      }
    });

    // ============================================
    // EVENT: Presença (online/offline/typing)
    // ============================================
    sock.ev.on('presence.update', (presence) => {
      logger.debug(`👁️ Presença: ${presence.id} - ${JSON.stringify(presence.presences)}`);
    });

    // ============================================
    // EVENT: Grupos atualizados
    // ============================================
    sock.ev.on('groups.update', (updates) => {
      for (const update of updates) {
        logger.log(`\n👥 Grupo atualizado:`);
        logger.log(`📱 ID: ${update.id}`);
        if (update.subject) logger.log(`📝 Nome: ${update.subject}`);
        if (update.desc) logger.log(`📄 Descrição: ${update.desc}`);
      }
    });

    logger.log('✅ WhatsApp inicializado com sucesso!');
    logger.log('📱 Aguardando mensagens...\n');

    return sock;
  } catch (error) {
    logger.error('❌ Erro ao inicializar WhatsApp:', error);
    throw error;
  }
}

// Função auxiliar para remover credenciais (forçar novo login)
export function clearWhatsAppCredentials() {
  logger.log('🗑️ Removendo credenciais...');
  if (fs.existsSync(AUTH_DIR)) {
    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    logger.log('✅ Credenciais removidas!');
  } else {
    logger.log('ℹ️ Nenhuma credencial para remover.');
  }
}
