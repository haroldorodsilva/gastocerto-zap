import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '@core/database/prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';
import {
  IMessagingProvider,
  MessagingPlatform,
  MessagingConnectionConfig,
  IncomingMessage,
} from '@common/interfaces/messaging-provider.interface';
import { TelegramProvider } from './telegram/telegram.provider';
import { UserRateLimiterService } from '@common/services/user-rate-limiter.service';
import { SessionStatus } from '@prisma/client';

interface PlatformSession {
  provider: IMessagingProvider;
  platform: MessagingPlatform;
  sessionId: string;
  isConnected: boolean;
  lastActivity: Date;
}

// Singleton global para prevenir duplicação em watch mode
const ACTIVE_SESSIONS_GLOBAL = new Map<string, boolean>();

@Injectable()
export class MultiPlatformSessionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MultiPlatformSessionService.name);
  private readonly sessions = new Map<string, PlatformSession>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly configService: ConfigService,
    private readonly userRateLimiter: UserRateLimiterService,
  ) {}

  async onModuleInit() {
    this.logger.log('🚀 MultiPlatformSessionService initialized');
    await this.autoStartActiveSessions();
  }

  async onModuleDestroy() {
    this.logger.log('🛑 MultiPlatformSessionService destroying - cleaning up sessions');

    // Desconectar todas as sessões
    for (const [sessionId, session] of this.sessions.entries()) {
      try {
        this.logger.log(`🧹 Disconnecting session: ${sessionId}`);
        await session.provider.disconnect();
        ACTIVE_SESSIONS_GLOBAL.delete(sessionId);
      } catch (error) {
        this.logger.error(`Error disconnecting session ${sessionId}:`, error);
      }
    }

    this.sessions.clear();
  }

  /**
   * Auto-start Telegram sessions that were active before shutdown
   */
  private async autoStartActiveSessions() {
    try {
      const activeTelegramSessions = await this.prisma.telegramSession.findMany({
        where: {
          isActive: true,
        },
      });

      this.logger.log(
        `📋 Found ${activeTelegramSessions.length} active Telegram session(s) to restore`,
      );

      for (const session of activeTelegramSessions) {
        try {
          if (session.token) {
            this.logger.log(
              `🔄 Auto-starting Telegram session: "${session.name}" (${session.sessionId})`,
            );
            await this.startTelegramSession(session.sessionId);
            this.logger.log(
              `✅ Telegram session "${session.name}" (${session.sessionId}) successfully activated and ready to receive messages`,
            );
          } else {
            this.logger.warn(
              `⚠️  Telegram session "${session.name}" (${session.sessionId}) has no token, skipping`,
            );
            await this.prisma.telegramSession.update({
              where: { sessionId: session.sessionId },
              data: {
                isActive: false,
                status: SessionStatus.DISCONNECTED,
              },
            });
          }
        } catch (error) {
          this.logger.warn(
            `❌ Failed to auto-start Telegram session "${session.name}" (${session.sessionId}): ${error.message}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(`Failed to load active Telegram sessions: ${error.message}`);
    }
  }

  /**
   * Inicia sessão do Telegram
   */
  async startTelegramSession(sessionId: string): Promise<void> {
    try {
      this.logger.log(`🚀 Starting Telegram session: ${sessionId}`);

      // ⚠️ VERIFICAR SINGLETON GLOBAL (previne duplicação em watch mode)
      if (ACTIVE_SESSIONS_GLOBAL.has(sessionId)) {
        this.logger.warn(
          `⚠️  Telegram session ${sessionId} is already running globally, skipping initialization`,
        );
        return;
      }

      // ⚠️ VERIFICAR SE JÁ ESTÁ RODANDO LOCALMENTE
      const existingSession = this.sessions.get(sessionId);
      if (existingSession?.isConnected) {
        this.logger.warn(
          `⚠️  Telegram session ${sessionId} is already running locally, skipping initialization`,
        );
        ACTIVE_SESSIONS_GLOBAL.set(sessionId, true);
        return;
      }

      // Se existe mas não está conectada, limpar primeiro
      if (existingSession) {
        this.logger.log(`🧹 Cleaning up old disconnected session: ${sessionId}`);
        try {
          await existingSession.provider.disconnect();
        } catch {
          // Ignorar erros ao desconectar sessão antiga
        }
        this.sessions.delete(sessionId);
      }

      // Buscar token do banco de dados (tabela telegram_sessions)
      const session = await this.prisma.telegramSession.findUnique({
        where: { sessionId },
        select: { token: true },
      });

      if (!session?.token) {
        throw new Error(
          `Telegram bot token not found for session ${sessionId}. Create session with token first.`,
        );
      }

      // Marcar como ativa no singleton global ANTES de inicializar
      ACTIVE_SESSIONS_GLOBAL.set(sessionId, true);

      // ✅ FIX: Criar uma NOVA instância de TelegramProvider para cada sessão
      const telegramProvider = new TelegramProvider(this.userRateLimiter);

      const config: MessagingConnectionConfig = {
        platform: MessagingPlatform.TELEGRAM,
        credentials: { token: session.token },
        sessionId,
      };

      await telegramProvider.initialize(config, {
        onConnected: () => this.handleConnected(sessionId, MessagingPlatform.TELEGRAM),
        onDisconnected: (reason) =>
          this.handleDisconnected(sessionId, MessagingPlatform.TELEGRAM, reason),
        onMessage: (message) => this.handleMessage(sessionId, message),
        onError: (error) => this.handleError(sessionId, error),
      });

      this.sessions.set(sessionId, {
        provider: telegramProvider,
        platform: MessagingPlatform.TELEGRAM,
        sessionId,
        isConnected: true,
        lastActivity: new Date(),
      });

      await this.prisma.telegramSession.update({
        where: { sessionId },
        data: {
          status: SessionStatus.CONNECTED,
          isActive: true,
        },
      });

      this.logger.log(`✅ Telegram session ${sessionId} started successfully`);
    } catch (error: any) {
      const errorMsg = error.message || String(error);
      this.logger.error(`Failed to start Telegram session ${sessionId}: ${errorMsg}`);
      throw error;
    }
  }

  /**
   * Para sessão
   */
  async stopSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.logger.warn(`Session ${sessionId} not found`);
      return;
    }

    this.logger.log(`🔴 Stopping ${session.platform} session: ${sessionId}`);

    await session.provider.disconnect();
    this.sessions.delete(sessionId);

    // Remover do singleton global
    ACTIVE_SESSIONS_GLOBAL.delete(sessionId);

    // Atualizar status no banco (WhatsApp ou Telegram)
    if (session.platform === MessagingPlatform.TELEGRAM) {
      await this.prisma.telegramSession
        .update({
          where: { sessionId },
          data: {
            status: SessionStatus.DISCONNECTED,
            isActive: false,
          },
        })
        .catch(() => {});
    } else {
      await this.prisma.whatsAppSession
        .update({
          where: { sessionId },
          data: {
            status: SessionStatus.DISCONNECTED,
            isActive: false,
          },
        })
        .catch(() => {});
    }

    this.logger.log(`✅ Session ${sessionId} stopped`);
  }

  /**
   * Envia mensagem de texto
   */
  async sendTextMessage(sessionId: string, chatId: string, text: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }

    await session.provider.sendTextMessage(chatId, text);
  }

  /**
   * Envia imagem
   */
  async sendImageMessage(
    sessionId: string,
    chatId: string,
    image: Buffer,
    caption?: string,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }

    await session.provider.sendImageMessage(chatId, image, { caption });
  }

  /**
   * Obtém sessão ativa
   */
  getSession(sessionId: string): PlatformSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Lista todas as sessões ativas
   */
  getActiveSessions(): PlatformSession[] {
    return Array.from(this.sessions.values());
  }

  private handleConnected(sessionId: string, platform: MessagingPlatform): void {
    this.logger.log(`✅ ${platform} session ${sessionId} connected`);
    this.eventEmitter.emit('session.connected', { sessionId, platform });
  }

  private handleDisconnected(
    sessionId: string,
    platform: MessagingPlatform,
    reason?: string,
  ): void {
    this.logger.warn(`📴 ${platform} session ${sessionId} disconnected: ${reason || 'unknown'}`);
    this.eventEmitter.emit('session.disconnected', { sessionId, platform, reason });
  }

  private async handleMessage(sessionId: string, message: IncomingMessage): Promise<void> {
    this.logger.log(
      `🔵 [MultiPlatformSessionService] handleMessage called for session ${sessionId}`,
    );

    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = new Date();
    }

    this.logger.log(
      `📩 [MultiPlatformSessionService] Message from ${message.platform} - Chat: ${message.chatId}, Type: ${message.type}`,
    );

    // Verificar se sessão está ativa no banco antes de processar
    try {
      const session = this.sessions.get(sessionId);
      let isActive = false;

      if (session?.platform === MessagingPlatform.TELEGRAM) {
        this.logger.log(
          `🔍 [MultiPlatformSessionService] Checking if Telegram session ${sessionId} is active...`,
        );
        const dbSession = await this.prisma.telegramSession.findUnique({
          where: { sessionId },
          select: { isActive: true },
        });
        isActive = dbSession?.isActive || false;
        this.logger.log(
          `✅ [MultiPlatformSessionService] Telegram session ${sessionId} isActive: ${isActive}`,
        );
      } else {
        const dbSession = await this.prisma.whatsAppSession.findUnique({
          where: { sessionId },
          select: { isActive: true },
        });
        isActive = dbSession?.isActive || false;
      }

      if (!isActive) {
        this.logger.warn(
          `⏸️ Session ${sessionId} is inactive. Message ignored. Use POST /:id/activate to resume.`,
        );
        return;
      }

      // Emitir evento para processamento apenas se sessão estiver ativa
      this.logger.log(
        `🚀 [MultiPlatformSessionService] Emitting telegram.message event for session ${sessionId}`,
      );
      this.eventEmitter.emit('telegram.message', {
        sessionId,
        platform: message.platform,
        message,
      });
      this.logger.log(`✅ [MultiPlatformSessionService] Event emitted successfully`);
    } catch (error: any) {
      const errorMsg = error.message || String(error);
      this.logger.error(`Failed to check session status for ${sessionId}: ${errorMsg}`);
    }
  }

  private handleError(sessionId: string, error: Error): void {
    // Log apenas mensagem essencial do erro
    const errorMsg = error.message || String(error);
    this.logger.error(`❌ Error in session ${sessionId}: ${errorMsg}`);
    this.eventEmitter.emit('session.error', { sessionId, error });
  }
}
