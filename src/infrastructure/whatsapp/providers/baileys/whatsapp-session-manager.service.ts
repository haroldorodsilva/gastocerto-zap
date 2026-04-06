import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '@core/database/prisma.service';
import { SessionStatus } from '@prisma/client';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  WASocket,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as path from 'path';
import * as fs from 'fs';
import { WhatsAppChatCacheService } from '@infrastructure/chat/whatsapp-chat-cache.service';
import { MESSAGE_EVENTS, SESSION_EVENTS, CHAT_EVENTS } from '@infrastructure/messaging/messaging-events.constants';

/**
 * WhatsAppSessionManager
 *
 * Gerencia sessões WhatsApp usando Baileys integrado com a API
 * Baseado no simple-whatsapp-init.ts mas adaptado para múltiplas sessões
 */
@Injectable()
export class WhatsAppSessionManager implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsAppSessionManager.name);

  // Map de sockets ativos: sessionId -> WASocket
  private readonly activeSockets = new Map<string, WASocket>();

  // Map de QR Codes atuais: sessionId -> qrCode
  private readonly currentQRCodes = new Map<string, string>();

  // Set para controlar sessões sendo paradas intencionalmente (evita auto-recuperação)
  private readonly stoppingSessions = new Set<string>();

  // Diretório base para autenticação (usa /tmp em produção para evitar problemas de permissão)
  private readonly BASE_AUTH_DIR =
    process.env.AUTH_SESSIONS_DIR || path.join(process.cwd(), '.auth_sessions');

  // Delay (ms) antes de forçar restart das sessões ativas no startup
  private readonly RESTART_DELAY_MS = parseInt(
    process.env.WHATSAPP_RESTART_DELAY_MS || '5000',
    10,
  );

  // Logger compatível com Baileys
  private readonly baileysLogger: any = {
    fatal: (...args: any[]) => this.logger.error(args.join(' ')),
    error: (...args: any[]) => this.logger.error(args.join(' ')),
    warn: (...args: any[]) => this.logger.warn(args.join(' ')),
    info: (...args: any[]) => this.logger.log(args.join(' ')),
    debug: (...args: any[]) => this.logger.debug(args.join(' ')),
    trace: (...args: any[]) => this.logger.verbose(args.join(' ')),
    child: () => this.baileysLogger,
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly chatCache: WhatsAppChatCacheService,
  ) {
    // Criar diretório base se não existir (com tratamento de erro)
    try {
      if (!fs.existsSync(this.BASE_AUTH_DIR)) {
        fs.mkdirSync(this.BASE_AUTH_DIR, { recursive: true });
        this.logger.log(`📁 Auth sessions directory created: ${this.BASE_AUTH_DIR}`);
      }
    } catch (error) {
      this.logger.warn(
        `⚠️ Could not create auth directory ${this.BASE_AUTH_DIR}: ${error.message}`,
      );
      this.logger.warn(`   Sessions will use database only (no local files)`);
    }
  }

  /**
   * Inicialização do módulo - restaura sessões ativas
   */
  async onModuleInit() {
    this.logger.log('✅ WhatsAppSessionManager initialized');
    // Auto-restore active sessions on startup
    await this.restoreActiveSessions();

    // Após RESTART_DELAY_MS, fazer force restart nas sessões ativas
    setTimeout(async () => {
      await this.forceRestartActiveSessions();
    }, this.RESTART_DELAY_MS);
  }

  /**
   * Destruição do módulo - desconecta todas as sessões WhatsApp
   *
   * IMPORTANTE: NÃO alteramos isActive no banco!
   * Apenas desconectamos os sockets para liberar recursos.
   * Quando o container subir novamente, ele reconecta automaticamente
   * as sessões que estavam ativas.
   */
  async onModuleDestroy() {
    this.logger.log('🛑 WhatsAppSessionManager destroying - cleaning up sessions');

    const disconnectPromises: Promise<void>[] = [];

    for (const [sessionId, sock] of this.activeSockets.entries()) {
      disconnectPromises.push(
        (async () => {
          try {
            this.logger.log(`🧹 Disconnecting WhatsApp session: ${sessionId}`);

            // Marcar como parada intencional para evitar auto-reconexão
            this.stoppingSessions.add(sessionId);

            // Fechar socket (sem fazer logout, preserva credenciais)
            sock.end(undefined);

            this.logger.log(`✅ WhatsApp session ${sessionId} disconnected`);
          } catch (error) {
            this.logger.error(`❌ Error disconnecting WhatsApp session ${sessionId}:`, error);
          }
        })(),
      );
    }

    // Aguardar todas as desconexões
    await Promise.all(disconnectPromises);

    this.activeSockets.clear();
    this.currentQRCodes.clear();
    this.stoppingSessions.clear();

    this.logger.log('✅ WhatsAppSessionManager cleanup complete');
  }

  /**
   * Retorna o diretório de autenticação para uma sessão
   */
  private getAuthDir(sessionId: string): string {
    return path.join(this.BASE_AUTH_DIR, sessionId);
  }

  /**
   * Salva credenciais do arquivo local para o banco de dados
   * Usado após primeira autenticação para persistência em Docker
   */
  private async saveCredsToDatabase(sessionId: string): Promise<void> {
    try {
      const authDir = this.getAuthDir(sessionId);
      const credsPath = path.join(authDir, 'creds.json');

      if (!fs.existsSync(credsPath)) {
        this.logger.warn(`⚠️ creds.json not found for session ${sessionId}`);
        return;
      }

      // Ler credenciais do arquivo
      const credsContent = fs.readFileSync(credsPath, 'utf-8');
      const creds = JSON.parse(credsContent);

      // Salvar no banco
      await this.prisma.whatsAppSession.update({
        where: { sessionId },
        data: { creds },
      });

      this.logger.log(`💾 Credentials saved to database for session: ${sessionId}`);
    } catch (error) {
      this.logger.error(`❌ Failed to save creds to database: ${error.message}`);
    }
  }

  /**
   * Restaura credenciais do banco para arquivo local
   * Usado ao iniciar container Docker para recuperar sessão
   */
  private async restoreCredsFromDatabase(sessionId: string): Promise<boolean> {
    try {
      // Buscar credenciais do banco
      const session = await this.prisma.whatsAppSession.findUnique({
        where: { sessionId },
        select: { creds: true },
      });

      if (!session?.creds) {
        this.logger.warn(`⚠️ No credentials in database for session ${sessionId}`);
        return false;
      }

      // Criar diretório se não existir
      const authDir = this.getAuthDir(sessionId);
      if (!fs.existsSync(authDir)) {
        fs.mkdirSync(authDir, { recursive: true });
      }

      // Escrever credenciais no arquivo
      const credsPath = path.join(authDir, 'creds.json');
      fs.writeFileSync(credsPath, JSON.stringify(session.creds, null, 2));

      this.logger.log(`📥 Credentials restored from database for session: ${sessionId}`);
      return true;
    } catch (error) {
      this.logger.error(`❌ Failed to restore creds from database: ${error.message}`);
      return false;
    }
  }

  /**
   * Restaura sessões ativas após o servidor reiniciar
   * Reconecta automaticamente usando credenciais salvas no banco
   * DOCKER-READY: Restaura do banco para arquivo temporário
   */
  private async restoreActiveSessions(): Promise<void> {
    try {
      this.logger.log('🔄 Restoring active sessions from database...');

      // Buscar sessões ativas com credenciais salvas
      const activeSessions = await this.prisma.whatsAppSession.findMany({
        where: {
          status: SessionStatus.CONNECTED,
          creds: { not: null },
        },
      });

      this.logger.log(`📦 Found ${activeSessions.length} active sessions to restore`);

      if (activeSessions.length === 0) {
        this.logger.log('ℹ️ No sessions to restore');
        return;
      }

      // Restaurar cada sessão (com delay para não sobrecarregar)
      for (const session of activeSessions) {
        try {
          this.logger.log(`🔌 Restoring session: ${session.sessionId}`);

          // 1. Restaurar credenciais do banco para arquivo local
          const restored = await this.restoreCredsFromDatabase(session.sessionId);

          if (!restored) {
            this.logger.warn(`⚠️ Could not restore creds for ${session.sessionId}, skipping...`);
            continue;
          }

          // 2. Iniciar sessão usando arquivo restaurado
          await this.startSession(session.sessionId);

          // Pequeno delay entre reconexões
          await new Promise((resolve) => setTimeout(resolve, 2000));
        } catch (error) {
          this.logger.error(`❌ Failed to restore session ${session.sessionId}: ${error.message}`);

          // Marcar como desconectada se falhar
          await this.updateSessionStatus(session.sessionId, SessionStatus.DISCONNECTED);
        }
      }

      this.logger.log('✅ Session restoration completed');
    } catch (error) {
      this.logger.error(`❌ Failed to restore sessions: ${error.message}`);
    }
  }

  /**
   * Force restart de todas as sessões ativas
   * Executado após delay configurável (WHATSAPP_RESTART_DELAY_MS) do startup
   */
  private async forceRestartActiveSessions(): Promise<void> {
    try {
      this.logger.log(`🔄 Starting force restart for active sessions (${this.RESTART_DELAY_MS}ms delay completed)...`);
      const activeSessions = await this.prisma.whatsAppSession.findMany({
        where: {
          isActive: true,
        },
      });

      this.logger.log(`🔥 Found ${activeSessions.length} active session(s) for force restart`);

      if (activeSessions.length === 0) {
        this.logger.log('ℹ️ No active sessions to force restart');
        return;
      }

      // Force restart cada sessão
      for (const session of activeSessions) {
        try {
          this.logger.log(`🔄 Force restarting session: ${session.sessionId}`);

          // Parar e iniciar novamente (force restart)
          await this.stopSession(session.sessionId);
          await new Promise((resolve) => setTimeout(resolve, 1000)); // 1s entre stop e start
          await this.startSession(session.sessionId);

          // Pequeno delay entre restarts
          await new Promise((resolve) => setTimeout(resolve, 2000));
        } catch (error) {
          this.logger.error(
            `❌ Failed to force restart session ${session.sessionId}: ${error.message}`,
          );
        }
      }

      this.logger.log('✅ Force restart completed for all active sessions');
    } catch (error) {
      this.logger.error(`❌ Failed to force restart sessions: ${error.message}`);
    }
  }

  /**
   * Verifica se uma sessão existe no banco
   */
  async sessionExists(sessionId: string): Promise<boolean> {
    const session = await this.prisma.whatsAppSession.findUnique({
      where: { sessionId },
    });
    return !!session;
  }

  /**
   * Cria nova sessão no banco de dados
   */
  async createSession(data: { sessionId: string; name: string; phoneNumber?: string }) {
    this.logger.log(`📝 Creating session: ${data.sessionId}`);

    return await this.prisma.whatsAppSession.create({
      data: {
        sessionId: data.sessionId,
        name: data.name,
        phoneNumber: data.phoneNumber || '',
        status: SessionStatus.DISCONNECTED,
        creds: {},
        isActive: false,
      },
    });
  }

  /**
   * Obtém sessão do banco
   */
  async getSession(sessionId: string) {
    const session = await this.prisma.whatsAppSession.findUnique({
      where: { sessionId },
    });

    if (!session) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }

    return session;
  }

  /**
   * Atualiza status da sessão
   */
  private async updateSessionStatus(
    sessionId: string,
    status: SessionStatus,
    phoneNumber?: string,
  ) {
    const updateData: any = {
      status,
      lastSeen: new Date(),
      updatedAt: new Date(),
    };

    if (phoneNumber) {
      updateData.phoneNumber = phoneNumber;
    }

    await this.prisma.whatsAppSession.update({
      where: { sessionId },
      data: updateData,
    });
  }

  /**
   * Ativa sessão (marca como isActive=true)
   */
  async activateSession(sessionId: string) {
    await this.prisma.whatsAppSession.update({
      where: { sessionId },
      data: { isActive: true },
    });
  }

  /**
   * Desativa sessão (marca como isActive=false)
   */
  async deactivateSession(sessionId: string) {
    await this.prisma.whatsAppSession.update({
      where: { sessionId },
      data: { isActive: false },
    });
  }

  /**
   * Inicia conexão WhatsApp para uma sessão
   */
  async startSession(sessionId: string): Promise<void> {
    this.logger.log(`🚀 Starting WhatsApp session: ${sessionId}`);

    // Verificar se sessão já está conectada
    if (this.activeSockets.has(sessionId)) {
      this.logger.warn(`⚠️  Session ${sessionId} already connected`);
      return;
    }

    // Ativar sessão
    await this.activateSession(sessionId);

    // Atualizar status
    await this.updateSessionStatus(sessionId, SessionStatus.CONNECTING);

    try {
      // Carregar versão do Baileys
      const { version, isLatest } = await fetchLatestBaileysVersion();
      this.logger.log(`📱 Baileys version: ${version.join('.')} (latest: ${isLatest})`);

      // Criar diretório de autenticação
      const authDir = this.getAuthDir(sessionId);
      if (!fs.existsSync(authDir)) {
        fs.mkdirSync(authDir, { recursive: true });
      }

      // Carregar estado de autenticação (arquivos)
      const { state, saveCreds } = await useMultiFileAuthState(authDir);

      // Criar socket WhatsApp
      const sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, this.baileysLogger),
        },
        logger: this.baileysLogger,
        browser: ['GastoCerto-ZAP', 'Chrome', '10.0.0'],
        markOnlineOnConnect: true,
        syncFullHistory: false,
        printQRInTerminal: false,
      });

      // Armazenar socket
      this.activeSockets.set(sessionId, sock);

      // Configurar event listeners
      this.setupSocketEventListeners(sessionId, sock, saveCreds);

      this.logger.log(`✅ WhatsApp socket initialized for session: ${sessionId}`);
    } catch (error) {
      this.logger.error(`❌ Error starting session ${sessionId}:`, error);
      await this.updateSessionStatus(sessionId, SessionStatus.DISCONNECTED);
      throw error;
    }
  }

  /**
   * Para conexão WhatsApp de uma sessão
   * Apenas remove da memória sem fazer logout, preservando credenciais
   */
  async stopSession(sessionId: string): Promise<void> {
    this.logger.log(`🛑 Stopping WhatsApp session: ${sessionId}`);

    const sock = this.activeSockets.get(sessionId);
    if (!sock) {
      this.logger.warn(`⚠️  Session ${sessionId} not connected`);
      return;
    }

    try {
      // Marca como parada intencional para evitar auto-recuperação
      this.stoppingSessions.add(sessionId);

      // Remover listeners antes de fechar para evitar memory leaks
      if (sock.ev) {
        const events = [
          'creds.update', 'connection.update', 'messages.upsert',
          'messages.update', 'chats.update', 'contacts.update', 'presence.update',
        ] as const;
        for (const event of events) {
          sock.ev.removeAllListeners(event);
        }
      }

      // Fecha conexão sem fazer logout (preserva credenciais)
      sock.end(undefined);

      // Remove da memória
      this.activeSockets.delete(sessionId);
      this.currentQRCodes.delete(sessionId);

      // Atualiza status no banco
      await this.updateSessionStatus(sessionId, SessionStatus.DISCONNECTED);
      await this.deactivateSession(sessionId);

      this.logger.log(`✅ Session ${sessionId} stopped successfully (credentials preserved)`);
    } catch (error) {
      this.logger.error(`❌ Error stopping session ${sessionId}:`, error);
      this.activeSockets.delete(sessionId);
      this.stoppingSessions.delete(sessionId);
      throw error;
    }
  }

  /**
   * Obtém QR Code atual de uma sessão
   */
  getQRCode(sessionId: string): string | null {
    return this.currentQRCodes.get(sessionId) || null;
  }

  /**
   * Verifica se sessão está conectada
   */
  isSessionConnected(sessionId: string): boolean {
    const sock = this.activeSockets.get(sessionId);
    return sock !== undefined && sock.user !== undefined;
  }

  /**
   * Envia mensagem via WhatsApp
   */
  async sendMessage(sessionId: string, to: string, text: string): Promise<boolean> {
    const sock = this.activeSockets.get(sessionId);
    if (!sock) {
      this.logger.error(`❌ Session ${sessionId} not connected`);
      return false;
    }

    try {
      const jid = to.includes('@') ? to : `${to.replace(/\D/g, '')}@s.whatsapp.net`;
      await sock.sendMessage(jid, { text });
      this.logger.log(`✅ Message sent via ${sessionId} to ${to}`);
      return true;
    } catch (error) {
      this.logger.error(`❌ Error sending message via ${sessionId}:`, error);
      return false;
    }
  }

  /**
   * Remove credenciais de uma sessão (força novo login)
   */
  async clearSessionCredentials(sessionId: string): Promise<void> {
    const authDir = this.getAuthDir(sessionId);

    if (fs.existsSync(authDir)) {
      fs.rmSync(authDir, { recursive: true, force: true });
      this.logger.log(`🗑️  Credentials cleared for session: ${sessionId}`);
    }

    await this.updateSessionStatus(sessionId, SessionStatus.DISCONNECTED);
  }

  /**
   * Configura event listeners do socket WhatsApp
   */
  private setupSocketEventListeners(
    sessionId: string,
    sock: WASocket,
    saveCreds: () => Promise<void>,
  ): void {
    // Salvar credenciais quando atualizadas
    sock.ev.on('creds.update', async () => {
      // 1. Salvar no arquivo (Baileys precisa)
      await saveCreds();

      // 2. Sincronizar com banco de dados (Docker persistence)
      await this.saveCredsToDatabase(sessionId);
    });

    // Atualização de conexão
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      // QR Code gerado
      if (qr) {
        this.logger.log(`📱 QR Code generated for session: ${sessionId}`);
        this.logger.debug(`📊 QR Code length: ${qr.length} characters`);
        this.currentQRCodes.set(sessionId, qr);

        // Emitir evento para WebSocket
        this.logger.log(`📡 Emitting 'session.qr' event for session: ${sessionId}`);
        this.eventEmitter.emit(SESSION_EVENTS.QR, {
          sessionId,
          qr,
        });
        this.logger.log(`✅ Event 'session.qr' emitted successfully for session: ${sessionId}`);
      }

      // Conexão fechada
      if (connection === 'close') {
        const shouldReconnect =
          (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;

        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        this.logger.warn(`❌ Session ${sessionId} connection closed. Status: ${statusCode}`);

        this.activeSockets.delete(sessionId);
        this.currentQRCodes.delete(sessionId);

        // Emitir evento de desconexão
        this.eventEmitter.emit(SESSION_EVENTS.DISCONNECTED, {
          sessionId,
          reason: lastDisconnect?.error?.message || 'Unknown',
        });

        await this.updateSessionStatus(sessionId, SessionStatus.DISCONNECTED);

        // Verificar se é uma parada intencional
        if (this.stoppingSessions.has(sessionId)) {
          this.logger.log(`✅ Session ${sessionId} stopped intentionally, skipping auto-recovery`);
          this.stoppingSessions.delete(sessionId);
          return;
        }

        if (shouldReconnect) {
          this.logger.log(`🔄 Reconnecting session ${sessionId} in 3s...`);
          setTimeout(() => this.startSession(sessionId), 3000);
        } else {
          // ✅ Status 401: Credenciais inválidas - limpar e gerar novo QR code
          this.logger.error(
            `❌ Session ${sessionId} logged out. Clearing credentials and generating new QR code...`,
          );

          try {
            // Limpar credenciais automaticamente
            await this.clearSessionCredentials(sessionId);
            this.logger.log(`🗑️  Credentials cleared automatically for session: ${sessionId}`);

            // Também limpar do banco de dados
            await this.prisma.whatsAppSession.update({
              where: { sessionId },
              data: {
                creds: null,
                status: SessionStatus.DISCONNECTED,
                updatedAt: new Date(),
              },
            });

            // Reiniciar sessão para gerar novo QR code (delay de 2s)
            this.logger.log(`🔄 Restarting session ${sessionId} to generate new QR code...`);
            setTimeout(() => {
              this.startSession(sessionId).catch((err) => {
                this.logger.error(`❌ Failed to restart session ${sessionId}: ${err.message}`);
              });
            }, 2000);
          } catch (error) {
            this.logger.error(
              `❌ Failed to clear credentials for session ${sessionId}: ${error.message}`,
            );
          }
        }
      }

      // Conexão aberta (sucesso)
      else if (connection === 'open') {
        const userName = sock.user?.name || sock.user?.verifiedName || 'WhatsApp';
        this.logger.log(`✅ Session ${sessionId} connected successfully!`);
        this.logger.log(`   📱 ID: ${sock.user?.id}`);
        this.logger.log(`   👤 Name: ${userName}`);

        this.currentQRCodes.delete(sessionId);

        // Atualizar banco de dados
        await this.updateSessionStatus(sessionId, SessionStatus.CONNECTED, sock.user?.id);

        // Emitir evento de QR code escaneado/concluído
        this.logger.log(`📱 Emitting 'session.qr.scanned' event for session: ${sessionId}`);
        this.eventEmitter.emit(SESSION_EVENTS.QR_SCANNED, {
          sessionId,
          success: true,
        });

        // Emitir evento de conexão
        this.eventEmitter.emit(SESSION_EVENTS.CONNECTED, {
          sessionId,
          phoneNumber: sock.user?.id,
          name: userName,
        });

        // 🔥 Sincronizar chats para o cache automaticamente
        this.syncChatsToCache(sessionId).catch((error) => {
          this.logger.error(`❌ Failed to sync chats to cache for ${sessionId}:`, error);
        });
      }

      // Conectando
      else if (connection === 'connecting') {
        this.logger.log(`🔄 Session ${sessionId} connecting...`);
        await this.updateSessionStatus(sessionId, SessionStatus.CONNECTING);
      }
    });

    // Mensagens recebidas
    sock.ev.on('messages.upsert', async ({ messages }) => {
      for (const msg of messages) {
        this.logger.log(`📨 Message received in session ${sessionId}: ${msg.key.id}`);

        // Extrair dados da mensagem
        const chatId = msg.key.remoteJid || '';
        const messageText =
          msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        const messageType = Object.keys(msg.message || {})[0] || 'unknown';
        const isGroup = chatId.includes('@g.us');

        // Cache: Salvar mensagem no Redis
        await this.chatCache.cacheMessage(sessionId, {
          id: msg.key.id || '',
          chatId,
          from: chatId,
          fromMe: msg.key.fromMe || false,
          text: messageText,
          messageType,
          timestamp: Number(msg.messageTimestamp) || Date.now(),
          pushName: msg.pushName,
        });

        // Cache: Atualizar/criar chat no Redis
        await this.chatCache.cacheChat(sessionId, {
          chatId,
          name: msg.pushName || chatId.split('@')[0],
          isGroup,
          lastMessageTimestamp: Number(msg.messageTimestamp) || Date.now(),
          lastMessageText: messageText,
          unreadCount: msg.key.fromMe ? 0 : 1,
        });

        // Se não é mensagem enviada por mim, incrementar contador
        if (!msg.key.fromMe) {
          await this.chatCache.incrementUnreadCount(sessionId, chatId);
        }

        // Emitir evento para processamento normal
        this.eventEmitter.emit(MESSAGE_EVENTS.WHATSAPP, {
          sessionId,
          message: msg,
        });

        // Emitir evento de mensagem recebida para WebSocket
        this.eventEmitter.emit(SESSION_EVENTS.MESSAGE_RECEIVED, {
          sessionId,
          from: msg.key.remoteJid,
          messageId: msg.key.id,
          text: messageText,
          fromMe: msg.key.fromMe || false,
          timestamp: msg.messageTimestamp,
        });

        // Marcar como lida
        if (!msg.key.fromMe && msg.key.remoteJid && msg.message) {
          try {
            await sock.readMessages([msg.key]);
          } catch (error) {
            this.logger.warn(`⚠️  Could not mark message as read: ${error.message}`);
          }
        }
      }
    });

    // Status de mensagem atualizado (lido, entregue, etc)
    sock.ev.on('messages.update', async (updates) => {
      for (const update of updates) {
        this.logger.debug(`📊 Message status updated: ${update.key.id}`);

        // Emitir evento de atualização de status
        this.eventEmitter.emit(CHAT_EVENTS.MESSAGE_STATUS_UPDATE, {
          sessionId,
          messageId: update.key.id,
          chatId: update.key.remoteJid,
          status: update.update,
        });
      }
    });

    // Chats atualizados
    sock.ev.on('chats.update', async (chats) => {
      for (const chat of chats) {
        this.logger.debug(`💬 Chat updated: ${chat.id}`);

        // Atualizar cache se o chat existe
        const cachedChat = await this.chatCache.getChat(sessionId, chat.id);
        if (cachedChat) {
          await this.chatCache.cacheChat(sessionId, {
            ...cachedChat,
            unreadCount: chat.unreadCount !== undefined ? chat.unreadCount : cachedChat.unreadCount,
          });
        }

        // Emitir evento de atualização de chat
        this.eventEmitter.emit('chat.update', {
          sessionId,
          chatId: chat.id,
          unreadCount: chat.unreadCount,
        });
      }
    });

    // Contatos atualizados
    sock.ev.on('contacts.update', async (contacts) => {
      for (const contact of contacts) {
        this.logger.debug(`👤 Contact updated: ${contact.id}`);

        // Emitir evento de atualização de contato
        this.eventEmitter.emit('contact.update', {
          sessionId,
          contactId: contact.id,
          name: contact.name,
          notify: contact.notify,
        });
      }
    });

    // Indicador de digitação
    sock.ev.on('presence.update', async ({ id, presences }) => {
      for (const [jid, presence] of Object.entries(presences)) {
        if (presence.lastKnownPresence === 'composing') {
          this.logger.debug(`✍️  ${jid} is typing in ${id}`);

          this.eventEmitter.emit('typing.start', {
            sessionId,
            chatId: id,
            participantId: jid,
          });
        } else if (presence.lastKnownPresence === 'available') {
          this.eventEmitter.emit('typing.stop', {
            sessionId,
            chatId: id,
            participantId: jid,
          });
        }
      }
    });
  }

  /**
   * Lista todas as sessões
   */
  async getAllSessions() {
    return await this.prisma.whatsAppSession.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Deleta sessão
   */
  async deleteSession(sessionId: string) {
    // Parar sessão se estiver ativa
    if (this.activeSockets.has(sessionId)) {
      await this.stopSession(sessionId);
    }

    // Remover credenciais
    await this.clearSessionCredentials(sessionId);

    // Deletar do banco
    await this.prisma.whatsAppSession.delete({
      where: { sessionId },
    });

    this.logger.log(`🗑️  Session ${sessionId} deleted`);
  }

  /**
   * Retorna todas as sessões ativas em memória
   */
  getActiveSessionIds(): string[] {
    return Array.from(this.activeSockets.keys());
  }

  /**
   * Retorna informações de todas as sessões com status real
   */
  async getAllSessionsWithRealStatus() {
    const dbSessions = await this.prisma.whatsAppSession.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return dbSessions.map((session) => ({
      ...session,
      // ✅ Sobrescrever status com estado real da memória
      realStatus: this.activeSockets.has(session.sessionId) ? 'CONNECTED' : 'DISCONNECTED',
      isReallyConnected: this.activeSockets.has(session.sessionId),
    }));
  }

  /**
   * Obtém metadados da sessão (perfil do usuário)
   */
  async getSessionMetadata(sessionId: string) {
    const sock = this.activeSockets.get(sessionId);
    if (!sock) {
      throw new NotFoundException(`Session ${sessionId} not connected`);
    }

    try {
      return {
        sessionId,
        user: {
          id: sock.user?.id,
          name: sock.user?.name || sock.user?.verifiedName,
        },
        connected: true,
        timestamp: new Date(),
      };
    } catch (error) {
      this.logger.error(`❌ Error getting metadata for ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Busca informações de perfil de um contato
   */
  async getContactProfile(sessionId: string, phoneNumber: string) {
    const sock = this.activeSockets.get(sessionId);
    if (!sock) {
      throw new NotFoundException(`Session ${sessionId} not connected`);
    }

    try {
      const jid = phoneNumber.includes('@')
        ? phoneNumber
        : `${phoneNumber.replace(/\D/g, '')}@s.whatsapp.net`;

      // Buscar status e foto de perfil
      const [statusResult, profilePictureResult] = await Promise.allSettled([
        sock.fetchStatus(jid),
        sock.profilePictureUrl(jid, 'image').catch(() => null),
      ]);

      const statusValue =
        statusResult.status === 'fulfilled' && statusResult.value
          ? (statusResult.value as any).status || null
          : null;

      const profilePictureValue =
        profilePictureResult.status === 'fulfilled' ? profilePictureResult.value : null;

      return {
        jid,
        phoneNumber: phoneNumber.replace(/\D/g, ''),
        status: statusValue,
        profilePicture: profilePictureValue,
        timestamp: new Date(),
      };
    } catch (error) {
      this.logger.error(`❌ Error getting contact profile for ${phoneNumber}:`, error);
      throw error;
    }
  }

  /**
   * Verifica se um número está registrado no WhatsApp
   */
  async checkNumberExists(sessionId: string, phoneNumber: string): Promise<boolean> {
    const sock = this.activeSockets.get(sessionId);
    if (!sock) {
      throw new NotFoundException(`Session ${sessionId} not connected`);
    }

    try {
      const jid = phoneNumber.includes('@')
        ? phoneNumber
        : `${phoneNumber.replace(/\D/g, '')}@s.whatsapp.net`;

      const [result] = await sock.onWhatsApp(jid);
      return result?.exists || false;
    } catch (error) {
      this.logger.error(`❌ Error checking number ${phoneNumber}:`, error);
      return false;
    }
  }

  /**
   * Envia mensagem com opções avançadas
   */
  async sendAdvancedMessage(
    sessionId: string,
    to: string,
    options: {
      text?: string;
      caption?: string;
      image?: string | Buffer;
      document?: { url: string; mimetype: string; fileName: string };
      documentBuffer?: { data: Buffer; mimetype: string; fileName: string };
    },
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const sock = this.activeSockets.get(sessionId);
    if (!sock) {
      return { success: false, error: `Session ${sessionId} not connected` };
    }

    try {
      // Validar parâmetro 'to'
      if (!to || typeof to !== 'string') {
        this.logger.error(`❌ Invalid 'to' parameter: ${to}`);
        return { success: false, error: 'Invalid recipient number' };
      }

      // Normalizar número: remover caracteres especiais
      let phoneNumber = to.replace(/\D/g, '');

      // Adicionar +55 se o número não começar com código do país
      if (!phoneNumber.startsWith('55') && phoneNumber.length <= 11) {
        phoneNumber = `55${phoneNumber}`;
        this.logger.debug(`📞 Added country code: ${to} -> ${phoneNumber}`);
      }

      const jid = to.includes('@') ? to : `${phoneNumber}@s.whatsapp.net`;

      const messageContent: any = {};

      if (options.text) {
        messageContent.text = options.text;
      }

      if (options.image) {
        messageContent.image = Buffer.isBuffer(options.image)
          ? options.image
          : { url: options.image };
        if (options.caption) messageContent.caption = options.caption;
      }

      if (options.documentBuffer) {
        messageContent.document = options.documentBuffer.data;
        messageContent.mimetype = options.documentBuffer.mimetype;
        messageContent.fileName = options.documentBuffer.fileName;
        if (options.caption) messageContent.caption = options.caption;
      } else if (options.document) {
        messageContent.document = { url: options.document.url };
        messageContent.mimetype = options.document.mimetype;
        messageContent.fileName = options.document.fileName;
      }

      const result = await sock.sendMessage(jid, messageContent);
      this.logger.log(`✅ Advanced message sent via ${sessionId} to ${phoneNumber}`);

      return {
        success: true,
        messageId: result?.key?.id,
      };
    } catch (error) {
      this.logger.error(`❌ Error sending advanced message via ${sessionId}:`, error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Lista todos os contatos da sessão
   * Busca do cache Redis (últimas 4 horas)
   */
  async getContacts(sessionId: string) {
    const sock = this.activeSockets.get(sessionId);
    if (!sock) {
      throw new NotFoundException(`Session ${sessionId} not connected`);
    }

    // Buscar do cache Redis
    const chats = await this.chatCache.getChats(sessionId, 100);

    // Filtrar apenas contatos individuais (não grupos)
    const contacts = chats
      .filter((chat) => !chat.isGroup)
      .map((chat) => ({
        id: chat.chatId,
        name: chat.name,
        lastMessageTimestamp: chat.lastMessageTimestamp,
        unreadCount: chat.unreadCount,
      }));

    this.logger.log(`📇 Retrieved ${contacts.length} contacts from cache for session ${sessionId}`);
    return contacts;
  }

  /**
   * Lista todos os chats ativos (incluindo grupos)
   * Busca do cache Redis (últimas 4 horas)
   */
  async getChats(sessionId: string) {
    const sock = this.activeSockets.get(sessionId);
    if (!sock) {
      throw new NotFoundException(`Session ${sessionId} not connected`);
    }

    try {
      // Buscar chats do cache Redis
      const cachedChats = await this.chatCache.getChats(sessionId, 50);

      const chats = cachedChats.map((chat) => ({
        id: chat.chatId,
        name: chat.name,
        isGroup: chat.isGroup,
        lastMessageTimestamp: chat.lastMessageTimestamp,
        lastMessageText: chat.lastMessageText,
        unreadCount: chat.unreadCount,
      }));

      this.logger.log(`💬 Retrieved ${chats.length} chats from cache for session ${sessionId}`);
      return chats;
    } catch (error) {
      this.logger.error(`❌ Error getting chats for ${sessionId}:`, error);
      return [];
    }
  }

  /**
   * Busca metadados de um grupo
   */
  async getGroupMetadata(sessionId: string, groupId: string) {
    const sock = this.activeSockets.get(sessionId);
    if (!sock) {
      throw new NotFoundException(`Session ${sessionId} not connected`);
    }

    try {
      const groupMetadata = await sock.groupMetadata(groupId);
      return {
        id: groupMetadata.id,
        subject: groupMetadata.subject,
        owner: groupMetadata.owner,
        creation: groupMetadata.creation,
        size: groupMetadata.size,
        participants: groupMetadata.participants.map((p) => ({
          id: p.id,
          isAdmin: p.admin === 'admin' || p.admin === 'superadmin',
          isSuperAdmin: p.admin === 'superadmin',
        })),
        desc: groupMetadata.desc,
        descOwner: groupMetadata.descOwner,
      };
    } catch (error) {
      this.logger.error(`❌ Error getting group metadata for ${groupId}:`, error);
      throw error;
    }
  }

  /**
   * Carrega mensagens de um chat específico
   * Busca do cache Redis (últimas 4 horas)
   */
  async getChatMessages(sessionId: string, chatId: string, limit = 50) {
    const sock = this.activeSockets.get(sessionId);
    if (!sock) {
      throw new NotFoundException(`Session ${sessionId} not connected`);
    }

    try {
      // Buscar mensagens do cache Redis
      const cachedMessages = await this.chatCache.getChatMessages(sessionId, chatId, limit);

      const messages = cachedMessages.map((msg) => ({
        id: msg.id,
        chatId: msg.chatId,
        from: msg.from,
        fromMe: msg.fromMe,
        text: msg.text,
        messageType: msg.messageType,
        timestamp: msg.timestamp,
        pushName: msg.pushName,
      }));

      this.logger.log(`📨 Retrieved ${messages.length} messages from cache for chat ${chatId}`);

      // Resetar contador de não lidas ao carregar mensagens
      await this.chatCache.resetUnreadCount(sessionId, chatId);

      return messages;
    } catch (error) {
      this.logger.error(`❌ Error getting messages for chat ${chatId}:`, error);
      throw error;
    }
  }

  /**
   * Sincroniza chats para o cache Redis (chamado automaticamente ao conectar)
   */
  private async syncChatsToCache(sessionId: string): Promise<void> {
    try {
      this.logger.log(`🔄 Syncing chats to cache for session ${sessionId}...`);

      const chats = await this.getChats(sessionId);

      let synced = 0;
      for (const chat of chats) {
        await this.chatCache.cacheChat(sessionId, {
          chatId: chat.id,
          name: chat.name,
          isGroup: chat.isGroup,
          lastMessageTimestamp: chat.lastMessageTimestamp || Date.now(),
          lastMessageText: undefined, // lastMessage não está disponível no tipo retornado
          unreadCount: chat.unreadCount || 0,
        });
        synced++;
      }

      this.logger.log(`✅ Synced ${synced} chats to cache for session ${sessionId}`);
    } catch (error) {
      this.logger.error(`❌ Error syncing chats to cache for ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Deleta uma mensagem específica
   */
  async deleteMessage(sessionId: string, messageId: string, chatId: string): Promise<boolean> {
    const sock = this.activeSockets.get(sessionId);
    if (!sock) {
      throw new NotFoundException(`Session ${sessionId} not connected`);
    }

    try {
      const jid = chatId.includes('@') ? chatId : `${chatId}@s.whatsapp.net`;
      await sock.sendMessage(jid, { delete: { id: messageId, remoteJid: jid, fromMe: true } });

      this.logger.log(`🗑️ Message ${messageId} deleted from chat ${chatId}`);
      return true;
    } catch (error) {
      this.logger.error(`❌ Error deleting message ${messageId}:`, error);
      throw error;
    }
  }

  /**
   * Limpa todas as mensagens de um chat
   */
  async clearChat(sessionId: string, chatId: string): Promise<boolean> {
    const sock = this.activeSockets.get(sessionId);
    if (!sock) {
      throw new NotFoundException(`Session ${sessionId} not connected`);
    }

    try {
      const jid = chatId.includes('@') ? chatId : `${chatId}@s.whatsapp.net`;
      // Limpa o chat deletando a conversa
      await sock.chatModify(
        { delete: true, lastMessages: [{ key: { id: '', fromMe: true }, messageTimestamp: 0 }] },
        jid,
      );

      this.logger.log(`🗑️ Chat ${chatId} cleared`);
      return true;
    } catch (error) {
      this.logger.error(`❌ Error clearing chat ${chatId}:`, error);
      throw error;
    }
  }

  /**
   * Exporta mensagens de um chat (formato JSON)
   */
  async exportChat(sessionId: string, chatId: string, limit = 100): Promise<any[]> {
    try {
      const messages = await this.getChatMessages(sessionId, chatId, limit);

      const exportData = messages.map((msg) => ({
        id: msg.id,
        from: msg.from,
        fromMe: msg.fromMe,
        text: msg.text,
        type: msg.messageType,
        timestamp: new Date(msg.timestamp).toISOString(),
        pushName: msg.pushName,
      }));

      this.logger.log(`📤 Exported ${exportData.length} messages from chat ${chatId}`);
      return exportData;
    } catch (error) {
      this.logger.error(`❌ Error exporting chat ${chatId}:`, error);
      throw error;
    }
  }

  /**
   * Bloqueia um contato
   */
  async blockContact(sessionId: string, phoneNumber: string): Promise<boolean> {
    const sock = this.activeSockets.get(sessionId);
    if (!sock) {
      throw new NotFoundException(`Session ${sessionId} not connected`);
    }

    try {
      const jid = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`;
      await sock.updateBlockStatus(jid, 'block');

      this.logger.log(`🚫 Contact ${phoneNumber} blocked`);
      return true;
    } catch (error) {
      this.logger.error(`❌ Error blocking contact ${phoneNumber}:`, error);
      throw error;
    }
  }

  /**
   * Desbloqueia um contato
   */
  async unblockContact(sessionId: string, phoneNumber: string): Promise<boolean> {
    const sock = this.activeSockets.get(sessionId);
    if (!sock) {
      throw new NotFoundException(`Session ${sessionId} not connected`);
    }

    try {
      const jid = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`;
      await sock.updateBlockStatus(jid, 'unblock');

      this.logger.log(`✅ Contact ${phoneNumber} unblocked`);
      return true;
    } catch (error) {
      this.logger.error(`❌ Error unblocking contact ${phoneNumber}:`, error);
      throw error;
    }
  }
}
