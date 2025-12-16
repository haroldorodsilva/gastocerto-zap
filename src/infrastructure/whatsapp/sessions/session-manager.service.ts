import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '@core/database/prisma.service';
import { SessionStatus } from '@prisma/client';
import { BaileysWhatsAppProvider } from './whatsapp/baileys-whatsapp.provider';
import { DatabaseAuthStateManager } from './whatsapp/database-auth-state.manager';
import { IWhatsAppProvider } from '@common/interfaces/whatsapp-provider.interface';

interface SessionInfo {
  sessionId: string;
  provider: IWhatsAppProvider;
  isConnected: boolean;
  lastActivity: Date;
  qrTimer?: NodeJS.Timeout;
  restartAttempts: number;
  restartTimer?: NodeJS.Timeout;
}

/**
 * Session Manager Service
 * Gerencia o ciclo de vida das sessões WhatsApp
 * - Inicialização automática de sessões ativas ao iniciar
 * - Reconexão automática em caso de falha
 * - Gerenciamento de múltiplas sessões simultâneas
 */
@Injectable()
export class SessionManagerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionManagerService.name);
  private readonly sessions = new Map<string, SessionInfo>();
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private readonly RECONNECT_DELAY_MS = 5000;
  private readonly RECONNECT_DELAY_515_MS = 300000; // 5 minutos para erro 515 (ban temporário)
  private readonly QR_TIMEOUT_MS = 120000; // 2 minutes

  constructor(
    private readonly prisma: PrismaService,
    private readonly authStateManager: DatabaseAuthStateManager,
    private readonly eventEmitter: EventEmitter2,
    private readonly baileysProvider: BaileysWhatsAppProvider,
  ) {}

  async onModuleInit() {
    this.logger.log('🚀 SessionManagerService initialized');
    await this.autoStartActiveSessions();
  }

  async onModuleDestroy() {
    this.logger.log('📴 Shutting down all sessions...');
    const sessionIds = Array.from(this.sessions.keys());
    await Promise.all(sessionIds.map((sessionId) => this.stopSession(sessionId).catch(() => {})));
  }

  /**
   * Auto-start sessions that were active before shutdown
   * Busca sessões com isActive: true e tenta reconectar
   */
  private async autoStartActiveSessions() {
    try {
      const activeSessions = await this.prisma.whatsAppSession.findMany({
        where: {
          isActive: true,
          status: {
            in: [SessionStatus.CONNECTED, SessionStatus.CONNECTING],
          },
        },
      });

      this.logger.log(`📋 Found ${activeSessions.length} active session(s) to restore`);

      for (const session of activeSessions) {
        try {
          const hasAuth = await this.authStateManager.hasAuthState(session.sessionId);

          if (hasAuth) {
            // Valida integridade das credenciais antes de tentar conectar
            const isValid = await this.authStateManager.validateAuthIntegrity(session.sessionId);

            if (isValid) {
              this.logger.log(
                `🔄 Auto-starting WhatsApp session: "${session.name}" (${session.sessionId})`,
              );
              await this.startSession(session.sessionId);
              this.logger.log(
                `✅ WhatsApp session "${session.name}" (${session.sessionId}) successfully activated and ready to receive messages`,
              );
            } else {
              this.logger.warn(
                `⚠️  WhatsApp session "${session.name}" (${session.sessionId}) has corrupted credentials, clearing...`,
              );
              await this.authStateManager.clearAuthState(session.sessionId);
              await this.prisma.whatsAppSession.update({
                where: { sessionId: session.sessionId },
                data: {
                  isActive: false,
                  status: SessionStatus.DISCONNECTED,
                },
              });
            }
          } else {
            this.logger.warn(
              `⚠️  WhatsApp session "${session.name}" (${session.sessionId}) has no auth state, skipping`,
            );
            // Update status to inactive since we can't connect
            await this.prisma.whatsAppSession.update({
              where: { sessionId: session.sessionId },
              data: {
                isActive: false,
                status: SessionStatus.DISCONNECTED,
              },
            });
          }
        } catch (error) {
          this.logger.warn(
            `❌ Failed to auto-start WhatsApp session "${session.name}" (${session.sessionId}): ${error.message}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(`Failed to load active sessions: ${error.message}`);
    }
  }

  /**
   * Start a WhatsApp session
   */
  async startSession(sessionId: string): Promise<void> {
    if (this.sessions.has(sessionId)) {
      this.logger.warn(`Session ${sessionId} already running`);
      return;
    }

    const session = await this.prisma.whatsAppSession.findUnique({
      where: { sessionId },
    });

    if (!session) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }

    try {
      this.logger.log(`🟡 Starting session: ${sessionId}`);

      // Create auth state using database manager
      const authState = await this.authStateManager.createBaileysAuthState(sessionId);

      // Create WhatsApp provider instance
      const provider = new BaileysWhatsAppProvider(
        {} as any, // ConfigService is not needed here, passed in module
      );

      // Initialize provider with callbacks
      await provider.initialize(
        {
          sessionId,
          authState: authState.state as any,
          printQRInTerminal: false,
          onCredsUpdate: authState.saveCreds,
        } as any,
        {
          onQR: (qr) => this.handleQRCode(sessionId, qr),
          onConnected: () => this.handleConnected(sessionId),
          onDisconnected: (reason) => this.handleDisconnected(sessionId, reason),
          onConnectionUpdate: (update) => this.handleConnectionUpdate(sessionId, provider, update),
          onMessage: (message) => this.handleMessage(sessionId, message),
          onError: (error) => this.handleError(sessionId, error),
        },
      );

      // Store session info
      const sessionInfo: SessionInfo = {
        sessionId,
        provider,
        isConnected: false,
        lastActivity: new Date(),
        restartAttempts: 0,
      };

      // Set QR timeout
      sessionInfo.qrTimer = setTimeout(() => {
        this.handleQRTimeout(sessionId);
      }, this.QR_TIMEOUT_MS);

      this.sessions.set(sessionId, sessionInfo);

      // Update database
      await this.prisma.whatsAppSession.update({
        where: { sessionId },
        data: {
          status: SessionStatus.CONNECTING,
          isActive: true,
        },
      });

      this.logger.log(`✅ Session ${sessionId} started successfully`);
      this.eventEmitter.emit('session.started', { sessionId });
    } catch (error) {
      this.logger.error(`Failed to start session ${sessionId}: ${error.message}`);

      // Update status to error
      await this.prisma.whatsAppSession
        .update({
          where: { sessionId },
          data: {
            status: SessionStatus.ERROR,
            isActive: false,
          },
        })
        .catch(() => {});

      throw new Error(`Failed to start session: ${error.message}`);
    }
  }

  /**
   * Stop a WhatsApp session
   */
  async stopSession(sessionId: string): Promise<void> {
    const sessionInfo = this.sessions.get(sessionId);
    if (!sessionInfo) {
      this.logger.warn(`Session ${sessionId} not found in memory`);
      return;
    }

    try {
      this.logger.log(`🔴 Stopping session: ${sessionId}`);

      // Clear timers
      if (sessionInfo.qrTimer) {
        clearTimeout(sessionInfo.qrTimer);
      }
      if (sessionInfo.restartTimer) {
        clearTimeout(sessionInfo.restartTimer);
      }

      // Disconnect provider
      await sessionInfo.provider.disconnect();

      // Remove from memory
      this.sessions.delete(sessionId);

      // Update database
      await this.prisma.whatsAppSession.update({
        where: { sessionId },
        data: {
          status: SessionStatus.DISCONNECTED,
          isActive: false,
          lastSeen: new Date(),
        },
      });

      this.logger.log(`✅ Session ${sessionId} stopped`);
      this.eventEmitter.emit('session.stopped', { sessionId });
    } catch (error) {
      this.logger.error(`Error stopping session ${sessionId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Restart a session
   */
  async restartSession(sessionId: string): Promise<void> {
    await this.stopSession(sessionId);
    await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2s
    await this.startSession(sessionId);
  }

  /**
   * Get session provider
   */
  getSession(sessionId: string): IWhatsAppProvider | null {
    const sessionInfo = this.sessions.get(sessionId);
    return sessionInfo?.provider || null;
  }

  /**
   * Check if session is active
   */
  isSessionActive(sessionId: string): boolean {
    const sessionInfo = this.sessions.get(sessionId);
    return sessionInfo?.isConnected || false;
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): string[] {
    return Array.from(this.sessions.keys()).filter((sessionId) => this.isSessionActive(sessionId));
  }

  /**
   * Event handlers
   */

  private async handleQRCode(sessionId: string, qr: string) {
    this.logger.log(`📱 QR Code generated for session: ${sessionId}`);

    await this.prisma.whatsAppSession
      .update({
        where: { sessionId },
        data: { status: SessionStatus.QR_PENDING },
      })
      .catch(() => {});

    this.eventEmitter.emit('session.qr', { sessionId, qr });
  }

  private async handleConnected(sessionId: string) {
    this.logger.log(`✅ Session connected: ${sessionId}`);

    const sessionInfo = this.sessions.get(sessionId);
    if (sessionInfo) {
      sessionInfo.isConnected = true;
      sessionInfo.restartAttempts = 0;
      sessionInfo.lastActivity = new Date();

      // Clear QR timer
      if (sessionInfo.qrTimer) {
        clearTimeout(sessionInfo.qrTimer);
        sessionInfo.qrTimer = undefined;
      }
    }

    await this.prisma.whatsAppSession
      .update({
        where: { sessionId },
        data: {
          status: SessionStatus.CONNECTED,
          isActive: true,
          lastSeen: new Date(),
        },
      })
      .catch(() => {});

    this.eventEmitter.emit('session.connected', { sessionId });
  }

  private async handleDisconnected(sessionId: string, reason?: string) {
    this.logger.warn(`📴 Session disconnected: ${sessionId}, reason: ${reason}`);

    const sessionInfo = this.sessions.get(sessionId);
    if (sessionInfo) {
      sessionInfo.isConnected = false;
    }

    await this.prisma.whatsAppSession
      .update({
        where: { sessionId },
        data: {
          status: SessionStatus.DISCONNECTED,
          lastSeen: new Date(),
        },
      })
      .catch(() => {});

    this.eventEmitter.emit('session.disconnected', { sessionId, reason });

    // Check for corrupted credentials (undefined 'public' key)
    const isCorruptedCredentials = reason?.includes(
      "Cannot read properties of undefined (reading 'public')",
    );

    if (isCorruptedCredentials) {
      this.logger.error(
        `❌ Corrupted credentials detected for ${sessionId} - Clearing auth state...`,
      );
      await this.stopSession(sessionId);
      await this.authStateManager.clearAuthState(sessionId);
      await this.prisma.whatsAppSession.update({
        where: { sessionId },
        data: {
          isActive: false,
          status: SessionStatus.DISCONNECTED,
        },
      });
      this.logger.log(`✅ Auth state cleared for ${sessionId}. Please scan QR code again.`);

      // Emit special event for corrupted credentials
      this.eventEmitter.emit('session.auth.corrupted', {
        sessionId,
        message: 'Credenciais corrompidas foram limpas. Por favor, escaneie o QR code novamente.',
      });
      return;
    }

    // Check for WhatsApp error code 515 (temporary ban)
    // O erro 515 pode aparecer como 'restart_required' ou 'stream:error' com code 515
    const isError515 =
      reason?.includes('515') || reason?.includes('stream:error') || reason === 'restart_required'; // ← Adiciona detecção do restart_required

    if (isError515) {
      this.logger.warn(`⚠️  WhatsApp error 515 detected for ${sessionId} - Temporary ban detected`);

      // IMPORTANTE: Erro 515 É TEMPORÁRIO - NÃO limpar credenciais!
      // As credenciais são válidas, apenas aguardar 2-24h
      this.logger.log(`🕒 Keeping credentials intact - error 515 is temporary`);

      await this.stopSession(sessionId);
      await this.prisma.whatsAppSession.update({
        where: { sessionId },
        data: {
          isActive: false,
          status: SessionStatus.ERROR,
        },
      });

      this.logger.log(`⏰ WhatsApp temporary ban usually lasts 2-24 hours. Try again later.`);
      this.logger.log(`✅ Credentials preserved - just scan QR code again after ban expires.`);

      // Emit event
      this.eventEmitter.emit('session.error.515', {
        sessionId,
        message:
          'WhatsApp error 515: Temporary ban detected. Credentials preserved. Please wait 2-24 hours and try to connect again.',
      });
      return;
    }

    // Auto-reconnect logic for other errors
    if (reason !== 'logged_out' && sessionInfo) {
      await this.scheduleReconnect(sessionId, false);
    } else {
      // Logged out or replaced - remove session
      await this.stopSession(sessionId);
      await this.authStateManager.clearAuthState(sessionId);
    }
  }

  private async handleConnectionUpdate(
    sessionId: string,
    provider: IWhatsAppProvider,
    update: any,
  ) {
    const sessionInfo = this.sessions.get(sessionId);
    if (sessionInfo) {
      sessionInfo.lastActivity = new Date();
    }

    this.logger.debug(
      `Connection update for ${sessionId}: ${JSON.stringify({
        status: update.status,
        reason: update.reason,
        shouldReconnect: update.shouldReconnect,
      })}`,
    );

    // Handle disconnection with reconnection logic
    if (update.status === 'DISCONNECTED' && update.shouldReconnect) {
      const reason = update.reason || 'unknown';

      // NÃO reconectar em logout ou conexão substituída
      if (reason === 'logged_out' || reason === 'connection_replaced') {
        this.logger.log(`🚫 No reconnect for ${sessionId}: ${reason}`);
        await this.handleDisconnected(sessionId, reason);
        return;
      }

      // Reconectar automaticamente para outros erros
      this.logger.log(`🔄 Scheduling auto-reconnect for ${sessionId} (reason: ${reason})`);
      await this.scheduleReconnect(sessionId, false, reason);
    }

    this.eventEmitter.emit('session.update', { sessionId, update });
  }

  private handleMessage(sessionId: string, message: any) {
    const sessionInfo = this.sessions.get(sessionId);
    if (sessionInfo) {
      sessionInfo.lastActivity = new Date();
    }

    this.eventEmitter.emit('whatsapp.message', { sessionId, message });
  }

  private handleError(sessionId: string, error: Error) {
    this.logger.error(`Session ${sessionId} error: ${error.message}`);
    this.eventEmitter.emit('session.error', { sessionId, error });
  }

  private handleQRTimeout(sessionId: string) {
    this.logger.warn(`⏰ QR code timeout for session: ${sessionId}`);
    this.eventEmitter.emit('session.qr.expired', { sessionId });
  }

  private async scheduleReconnect(sessionId: string, isError515: boolean = false, reason?: string) {
    const sessionInfo = this.sessions.get(sessionId);
    if (!sessionInfo) return;

    if (sessionInfo.restartAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      this.logger.error(
        `❌ Max reconnect attempts (${this.MAX_RECONNECT_ATTEMPTS}) reached for session: ${sessionId}`,
      );
      await this.stopSession(sessionId);
      return;
    }

    sessionInfo.restartAttempts++;

    // Use longer delay for WhatsApp error 515 (temporary ban)
    const baseDelay = isError515 ? this.RECONNECT_DELAY_515_MS : this.RECONNECT_DELAY_MS;
    const delay = baseDelay * sessionInfo.restartAttempts;

    const delayMinutes = Math.floor(delay / 60000);
    const delaySeconds = Math.floor((delay % 60000) / 1000);
    const delayStr = delayMinutes > 0 ? `${delayMinutes}m ${delaySeconds}s` : `${delaySeconds}s`;

    this.logger.log(
      `🔄 Scheduling reconnect for session ${sessionId} (attempt ${sessionInfo.restartAttempts}/${this.MAX_RECONNECT_ATTEMPTS}) in ${delayStr}${isError515 ? ' [Error 515 - Extended delay]' : ''}${reason ? ` - Reason: ${reason}` : ''}`,
    );

    sessionInfo.restartTimer = setTimeout(async () => {
      try {
        await this.restartSession(sessionId);
      } catch (error) {
        this.logger.error(`Reconnect failed for session ${sessionId}: ${error.message}`);
      }
    }, delay);
  }
}
