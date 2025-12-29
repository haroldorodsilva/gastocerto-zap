import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
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

/**
 * WhatsAppSessionManager
 *
 * Gerencia sessões WhatsApp usando Baileys integrado com a API
 * Baseado no simple-whatsapp-init.ts mas adaptado para múltiplas sessões
 */
@Injectable()
export class WhatsAppSessionManager implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppSessionManager.name);

  // Map de sockets ativos: sessionId -> WASocket
  private readonly activeSockets = new Map<string, WASocket>();

  // Map de QR Codes atuais: sessionId -> qrCode
  private readonly currentQRCodes = new Map<string, string>();

  // Diretório base para autenticação
  private readonly BASE_AUTH_DIR = path.join(process.cwd(), '.auth_sessions');

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
  ) {
    // Criar diretório base se não existir
    if (!fs.existsSync(this.BASE_AUTH_DIR)) {
      fs.mkdirSync(this.BASE_AUTH_DIR, { recursive: true });
    }
  }

  /**
   * Inicialização do módulo - restaura sessões ativas
   */
  async onModuleInit() {
    this.logger.log('✅ WhatsAppSessionManager initialized');
    // Auto-restore active sessions on startup
    await this.restoreActiveSessions();
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
   */
  async stopSession(sessionId: string): Promise<void> {
    this.logger.log(`🛑 Stopping WhatsApp session: ${sessionId}`);

    const sock = this.activeSockets.get(sessionId);
    if (!sock) {
      this.logger.warn(`⚠️  Session ${sessionId} not connected`);
      return;
    }

    try {
      await sock.logout();
      this.activeSockets.delete(sessionId);
      this.currentQRCodes.delete(sessionId);

      await this.updateSessionStatus(sessionId, SessionStatus.DISCONNECTED);
      await this.deactivateSession(sessionId);

      this.logger.log(`✅ Session ${sessionId} stopped successfully`);
    } catch (error) {
      this.logger.error(`❌ Error stopping session ${sessionId}:`, error);
      this.activeSockets.delete(sessionId);
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
        this.currentQRCodes.set(sessionId, qr);

        // Emitir evento para WebSocket
        this.eventEmitter.emit('session.qr', {
          sessionId,
          qr,
        });
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
        this.eventEmitter.emit('session.disconnected', {
          sessionId,
          reason: lastDisconnect?.error?.message || 'Unknown',
        });

        await this.updateSessionStatus(sessionId, SessionStatus.DISCONNECTED);

        if (shouldReconnect) {
          this.logger.log(`🔄 Reconnecting session ${sessionId} in 3s...`);
          setTimeout(() => this.startSession(sessionId), 3000);
        } else {
          this.logger.error(`❌ Session ${sessionId} logged out. Clear credentials and restart.`);
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

        // Emitir evento de conexão
        this.eventEmitter.emit('session.connected', {
          sessionId,
          phoneNumber: sock.user?.id,
          name: userName,
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

        // Emitir evento para processamento
        this.eventEmitter.emit('whatsapp.message', {
          sessionId,
          message: msg,
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
}
