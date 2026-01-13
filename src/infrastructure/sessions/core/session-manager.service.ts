import { Injectable, Logger, NotFoundException, forwardRef, Inject } from '@nestjs/common';
import { PrismaService } from '@core/database/prisma.service';
import { SessionStatus } from '@prisma/client';
import { WhatsAppSessionManager } from '@infrastructure/whatsapp/providers/baileys/whatsapp-session-manager.service';

/**
 * SessionManagerService - BRIDGE para WhatsAppSessionManager
 *
 * Este service mantém compatibilidade com código existente
 * mas delega toda a lógica para o WhatsAppSessionManager
 */
@Injectable()
export class SessionManagerService {
  private readonly logger = new Logger(SessionManagerService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => WhatsAppSessionManager))
    private readonly whatsappSessionManager: WhatsAppSessionManager,
  ) {
    this.logger.log('✅ SessionManagerService initialized (Bridge mode)');
  }

  // ============================================================================
  // CRUD METHODS (Database only)
  // ============================================================================

  /**
   * Get session by sessionId
   */
  async getSessionBySessionId(sessionId: string) {
    const session = await this.prisma.whatsAppSession.findUnique({
      where: { sessionId },
    });

    if (!session) {
      throw new NotFoundException(`Session ${sessionId} not found`);
    }

    return session;
  }

  /**
   * Get session by ID
   */
  async getSessionById(id: string) {
    const session = await this.prisma.whatsAppSession.findUnique({
      where: { id },
    });

    if (!session) {
      throw new NotFoundException(`Session with ID ${id} not found`);
    }

    return session;
  }

  /**
   * Create a new session
   */
  async createSession(data: { sessionId: string; phoneNumber: string; name?: string }) {
    const session = await this.prisma.whatsAppSession.create({
      data: {
        sessionId: data.sessionId,
        phoneNumber: data.phoneNumber,
        name: data.name,
        status: SessionStatus.DISCONNECTED,
        isActive: false,
      },
    });

    this.logger.log(`📝 Session created: ${session.sessionId}`);
    return session;
  }

  /**
   * Update session
   */
  async updateSession(
    id: string,
    data: Partial<{
      name: string;
      phoneNumber: string;
      isActive: boolean;
      status: SessionStatus;
    }>,
  ) {
    return this.prisma.whatsAppSession.update({
      where: { id },
      data: {
        ...data,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Delete session from database
   */
  async deleteSession(sessionId: string) {
    await this.prisma.whatsAppSession.delete({
      where: { sessionId },
    });
    this.logger.log(`🗑️  Session ${sessionId} deleted from database`);
  }

  /**
   * Clear session credentials
   */
  async clearSessionCredentials(sessionId: string) {
    return this.prisma.whatsAppSession.update({
      where: { sessionId },
      data: {
        creds: null,
        status: SessionStatus.DISCONNECTED,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Get active sessions count
   */
  async getActiveSessionsCount(): Promise<number> {
    return this.prisma.whatsAppSession.count({
      where: {
        isActive: true,
        status: {
          in: [SessionStatus.CONNECTED, SessionStatus.CONNECTING],
        },
      },
    });
  }

  // ============================================================================
  // BRIDGE METHODS (Delegam para WhatsAppSessionManager)
  // ============================================================================

  /**
   * Inicia sessão do WhatsApp
   */
  async startSession(sessionId: string): Promise<void> {
    return await this.whatsappSessionManager.startSession(sessionId);
  }

  /**
   * Para sessão do WhatsApp
   */
  async stopSession(sessionId: string, permanent = false): Promise<void> {
    await this.whatsappSessionManager.stopSession(sessionId);

    if (permanent) {
      await this.whatsappSessionManager.deleteSession(sessionId);
    }
  }

  /**
   * Envia mensagem via WhatsApp
   */
  async sendMessage(sessionId: string, to: string, message: string): Promise<any> {
    return await this.whatsappSessionManager.sendMessage(sessionId, to, message);
  }

  /**
   * Obtém QR Code da sessão
   */
  async getQRCode(sessionId: string): Promise<string | null> {
    return this.whatsappSessionManager.getQRCode(sessionId);
  }

  /**
   * Verifica se sessão está conectada
   */
  isSessionConnected(sessionId: string): boolean {
    return this.whatsappSessionManager.isSessionConnected(sessionId);
  }

  /**
   * Obtém socket da sessão
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getSession(_sessionId: string): any {
    // Por enquanto retorna null, pode ser expandido no futuro
    return null;
  }
}
