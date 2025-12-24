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
import { BaileysProviderFactory } from './whatsapp/baileys-provider.factory';
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
  error515Attempts?: number; // Tentativas específicas para erro 515
  lastError515?: Date; // Última ocorrência do erro 515
  connectingTimeout?: NodeJS.Timeout; // Timeout para estado CONNECTING
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
  private readonly MAX_ERROR_515_ATTEMPTS = 10; // Mais tentativas para erro 515 (2-24h)
  private readonly QR_TIMEOUT_MS = 120000; // 2 minutes
  private readonly CONNECTING_TIMEOUT_MS = 60000; // 60 segundos timeout para CONNECTING

  constructor(
    private readonly prisma: PrismaService,
    private readonly authStateManager: DatabaseAuthStateManager,
    private readonly eventEmitter: EventEmitter2,
    private readonly providerFactory: BaileysProviderFactory,
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
    // Verificar se sessão já está rodando COM provider ativo
    const existingSession = this.sessions.get(sessionId);
    if (existingSession && existingSession.provider) {
      this.logger.warn(`Session ${sessionId} already running with active provider`);
      return;
    }

    // Se sessão existe MAS sem provider (ex: após erro 515), preservar tracking data
    let preservedError515Attempts = 0;
    let preservedLastError515: Date | undefined;

    if (existingSession && !existingSession.provider) {
      this.logger.log(`Session ${sessionId} exists without provider (retry scenario), recreating...`);
      // Preservar dados de tracking de erro 515
      preservedError515Attempts = existingSession.error515Attempts || 0;
      preservedLastError515 = existingSession.lastError515;
      this.sessions.delete(sessionId);
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

      // Create WhatsApp provider instance usando factory (DI pattern)
      const provider = await this.providerFactory.create(sessionId);

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

      // Store session info (preservando tracking de erro 515 se for retry)
      const sessionInfo: SessionInfo = {
        sessionId,
        provider,
        isConnected: false,
        lastActivity: new Date(),
        restartAttempts: 0,
        error515Attempts: preservedError515Attempts,
        lastError515: preservedLastError515,
      };

      // Set QR timeout
      sessionInfo.qrTimer = setTimeout(() => {
        this.handleQRTimeout(sessionId);
      }, this.QR_TIMEOUT_MS);

      // Set CONNECTING timeout (60s)
      sessionInfo.connectingTimeout = setTimeout(() => {
        this.handleConnectingTimeout(sessionId);
      }, this.CONNECTING_TIMEOUT_MS);

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
    const sessionInfo = this.sessions.get(sessionId);

    // Se sessão tem provider ativo, parar primeiro
    if (sessionInfo?.provider) {
      await this.stopSession(sessionId);
      await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2s
    } else {
      // Sessão já foi parada (ex: erro 515), apenas aguardar um pouco
      this.logger.log(`Session ${sessionId} already stopped, just waiting before restart...`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

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

      // Limpar timeouts quando conectar com sucesso
      if (sessionInfo.qrTimer) {
        clearTimeout(sessionInfo.qrTimer);
        sessionInfo.qrTimer = undefined;
      }
      if (sessionInfo.connectingTimeout) {
        clearTimeout(sessionInfo.connectingTimeout);
        sessionInfo.connectingTimeout = undefined;
      }
      sessionInfo.restartAttempts = 0;
      sessionInfo.error515Attempts = 0; // Reset contador de erro 515 ao conectar
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
      reason?.includes('515') || reason?.includes('stream:error') || reason === 'restart_required';

    if (isError515) {
      this.logger.warn(`⚠️  WhatsApp error 515 detected for ${sessionId} - Temporary ban detected`);

      if (!sessionInfo) {
        this.logger.error(`Session ${sessionId} not found in memory for error 515 handling`);
        return;
      }

      // IMPORTANTE: Erro 515 É TEMPORÁRIO - NÃO limpar credenciais!
      // As credenciais são válidas, apenas aguardar e tentar reconectar
      this.logger.log(`🕒 Keeping credentials intact - error 515 is temporary`);

      // Incrementar contador de tentativas específico para erro 515
      sessionInfo.error515Attempts = (sessionInfo.error515Attempts || 0) + 1;
      sessionInfo.lastError515 = new Date();
      sessionInfo.isConnected = false;

      // Verificar se excedeu o limite de tentativas para erro 515
      if (sessionInfo.error515Attempts > this.MAX_ERROR_515_ATTEMPTS) {
        this.logger.error(
          `❌ Max error 515 attempts (${this.MAX_ERROR_515_ATTEMPTS}) reached for ${sessionId}`
        );

        // NÃO deletar credenciais! Apenas marcar como ERROR e notificar admin
        await this.prisma.whatsAppSession.update({
          where: { sessionId },
          data: {
            status: SessionStatus.ERROR,
            lastSeen: new Date(),
          },
        });

        this.eventEmitter.emit('session.error.515.max_attempts', {
          sessionId,
          attempts: sessionInfo.error515Attempts,
          message:
            'WhatsApp ban temporário - Atingiu máximo de tentativas. ' +
            'Credenciais preservadas. Aguarde 24h ou contate suporte.'
        });

        // Parar sessão mas NÃO deletar credenciais
        await this.stopSession(sessionId);
        return;
      }

      // IMPORTANTE: Limpar completamente a sessão para evitar corrupção de credenciais
      // O provider fica em estado inconsistente após erro 515
      await this.stopSession(sessionId);

      // MANTER sessionInfo básico no Map para tracking de tentativas
      const errorInfo: SessionInfo = {
        sessionId,
        provider: null as any, // Será recriado no restart
        isConnected: false,
        lastActivity: new Date(),
        restartAttempts: 0,
        error515Attempts: sessionInfo.error515Attempts,
        lastError515: sessionInfo.lastError515,
      };
      this.sessions.set(sessionId, errorInfo);

      // Atualizar status no banco
      await this.prisma.whatsAppSession.update({
        where: { sessionId },
        data: {
          status: SessionStatus.DISCONNECTED,
          lastSeen: new Date(),
        },
      });

      // Calcular delay com backoff exponencial
      // Attempt 1: 5min, Attempt 2: 10min, Attempt 3: 20min, ..., Max: 24h
      const baseDelay = this.RECONNECT_DELAY_515_MS; // 5 minutos
      const delay = Math.min(
        baseDelay * Math.pow(2, sessionInfo.error515Attempts - 1),
        86400000 // Max 24 horas
      );

      const delayMinutes = Math.floor(delay / 60000);
      const delayHours = Math.floor(delayMinutes / 60);
      const remainingMinutes = delayMinutes % 60;

      this.logger.log(
        `⏰ WhatsApp temporary ban - Attempt ${sessionInfo.error515Attempts}/${this.MAX_ERROR_515_ATTEMPTS}`,
      );
      this.logger.log(`✅ Credentials preserved - Will retry in ${delayHours}h ${remainingMinutes}min`);

      // Emit event
      this.eventEmitter.emit('session.error.515', {
        sessionId,
        attempts: sessionInfo.error515Attempts,
        maxAttempts: this.MAX_ERROR_515_ATTEMPTS,
        delayMs: delay,
        message:
          `WhatsApp error 515: Temporary ban detected (attempt ${sessionInfo.error515Attempts}/${this.MAX_ERROR_515_ATTEMPTS}). ` +
          `Credentials preserved. Retrying in ${delayHours}h ${remainingMinutes}min...`,
      });

      // ✅ AGENDAR RETRY com backoff exponencial (sessionInfo ainda está no Map!)
      await this.scheduleReconnect(sessionId, true, 'error_515');
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

  /**
   * Handle CONNECTING state timeout (60s)
   * Se sessão ficar presa em CONNECTING, reiniciar
   */
  private handleConnectingTimeout(sessionId: string) {
    const sessionInfo = this.sessions.get(sessionId);
    if (!sessionInfo) {
      return;
    }

    // Verificar se ainda está em CONNECTING
    if (!sessionInfo.isConnected) {
      this.logger.warn(
        `⏰ CONNECTING timeout para sessão ${sessionId}. ` +
        `Sessão ficou presa em estado CONNECTING por mais de 60s. Reiniciando...`
      );

      this.eventEmitter.emit('session.connecting.timeout', { sessionId });

      // Tentar reiniciar sessão
      this.handleDisconnected(sessionId, 'timeout_connecting');
    }
  }

  private async scheduleReconnect(sessionId: string, isError515: boolean = false, reason?: string) {
    const sessionInfo = this.sessions.get(sessionId);
    if (!sessionInfo) {
      this.logger.warn(`Cannot schedule reconnect for ${sessionId}: session not found in memory`);
      return;
    }

    // Limpar timer anterior se existir
    if (sessionInfo.restartTimer) {
      clearTimeout(sessionInfo.restartTimer);
      sessionInfo.restartTimer = undefined;
    }

    // Para erro 515, usar contador e limite específicos
    if (isError515) {
      const attempts = sessionInfo.error515Attempts || 0;
      const maxAttempts = this.MAX_ERROR_515_ATTEMPTS;

      if (attempts >= maxAttempts) {
        this.logger.error(
          `❌ Max error 515 attempts (${maxAttempts}) reached for session: ${sessionId}`,
        );
        // NÃO deletar credenciais - já foi tratado em handleDisconnected
        await this.stopSession(sessionId);
        return;
      }

      // Delay com backoff exponencial: 5min, 10min, 20min, ..., Max: 24h
      const baseDelay = this.RECONNECT_DELAY_515_MS; // 5 minutos
      const delay = Math.min(
        baseDelay * Math.pow(2, attempts - 1),
        86400000 // Max 24 horas
      );

      const delayMinutes = Math.floor(delay / 60000);
      const delayHours = Math.floor(delayMinutes / 60);
      const remainingMinutes = delayMinutes % 60;
      const delayStr = delayHours > 0
        ? `${delayHours}h ${remainingMinutes}min`
        : `${delayMinutes}min`;

      this.logger.log(
        `🔄 Scheduling reconnect for error 515 - ${sessionId} (attempt ${attempts}/${maxAttempts}) in ${delayStr}`,
      );

      sessionInfo.restartTimer = setTimeout(async () => {
        try {
          this.logger.log(`🔄 Attempting to restart session ${sessionId} after error 515...`);
          await this.restartSession(sessionId);
        } catch (error) {
          this.logger.error(`Reconnect failed for session ${sessionId}: ${error.message}`);
        }
      }, delay);
    } else {
      // Lógica normal para outros erros
      if (sessionInfo.restartAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
        this.logger.error(
          `❌ Max reconnect attempts (${this.MAX_RECONNECT_ATTEMPTS}) reached for session: ${sessionId}`,
        );
        await this.stopSession(sessionId);
        return;
      }

      sessionInfo.restartAttempts++;

      const delay = this.RECONNECT_DELAY_MS * sessionInfo.restartAttempts;
      const delayMinutes = Math.floor(delay / 60000);
      const delaySeconds = Math.floor((delay % 60000) / 1000);
      const delayStr = delayMinutes > 0 ? `${delayMinutes}m ${delaySeconds}s` : `${delaySeconds}s`;

      this.logger.log(
        `🔄 Scheduling reconnect for session ${sessionId} (attempt ${sessionInfo.restartAttempts}/${this.MAX_RECONNECT_ATTEMPTS}) in ${delayStr}${reason ? ` - Reason: ${reason}` : ''}`,
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
}
