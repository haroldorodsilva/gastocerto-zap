import { Injectable, Logger, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '@core/database/prisma.service';
import { WhatsAppSession, SessionStatus } from '@prisma/client';
import { CreateSessionDto, UpdateSessionDto, ListSessionsQueryDto } from './dto/session.dto';

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cria nova sessão WhatsApp
   */
  async createSession(data: CreateSessionDto): Promise<WhatsAppSession> {
    try {
      // Gerar sessionId se não foi fornecido
      const sessionId =
        data.sessionId || `session-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      // phoneNumber será preenchido após escanear QR code
      const phoneNumber = data.phoneNumber || `pending-${sessionId}`;

      // Verificar se sessionId já existe
      const existing = await this.prisma.whatsAppSession.findUnique({
        where: { sessionId },
      });

      if (existing) {
        throw new ConflictException(`Sessão com ID '${sessionId}' já existe`);
      }

      // Criar sessão
      const session = await this.prisma.whatsAppSession.create({
        data: {
          sessionId,
          phoneNumber,
          name: data.name,
          status: SessionStatus.INACTIVE,
          isActive: false,
        },
      });

      this.logger.log(`✅ Sessão criada: ${session.sessionId} - Aguardando QR code`);

      return session;
    } catch (error) {
      this.logger.error('Erro ao criar sessão:', error);
      throw error;
    }
  }

  /**
   * Lista todas as sessões
   */
  async listSessions(query?: ListSessionsQueryDto): Promise<WhatsAppSession[]> {
    const where: any = {};

    if (query?.status) {
      where.status = query.status;
    }

    if (query?.isActive !== undefined) {
      where.isActive = query.isActive;
    }

    if (query?.search) {
      where.OR = [
        { sessionId: { contains: query.search, mode: 'insensitive' } },
        { phoneNumber: { contains: query.search } },
        { name: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.whatsAppSession.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Busca sessão por ID
   */
  async getSessionById(id: string): Promise<WhatsAppSession> {
    const session = await this.prisma.whatsAppSession.findUnique({
      where: { id },
    });

    if (!session) {
      throw new NotFoundException(`Sessão com ID '${id}' não encontrada`);
    }

    return session;
  }

  /**
   * Busca sessão por sessionId
   */
  async getSessionBySessionId(sessionId: string): Promise<WhatsAppSession | null> {
    return this.prisma.whatsAppSession.findUnique({
      where: { sessionId },
    });
  }

  /**
   * Busca sessão por número de telefone
   * Retorna a primeira sessão ativa encontrada
   */
  async getSessionByPhoneNumber(phoneNumber: string): Promise<WhatsAppSession | null> {
    return this.prisma.whatsAppSession.findFirst({
      where: { phoneNumber },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /**
   * Atualiza sessão
   */
  async updateSession(id: string, data: UpdateSessionDto): Promise<WhatsAppSession> {
    try {
      const session = await this.prisma.whatsAppSession.update({
        where: { id },
        data,
      });

      this.logger.log(`✅ Sessão atualizada: ${session.sessionId}`);

      return session;
    } catch (error) {
      this.logger.error('Erro ao atualizar sessão:', error);
      throw new NotFoundException(`Sessão com ID '${id}' não encontrada`);
    }
  }

  /**
   * Atualiza status da sessão
   */
  async updateStatus(id: string, status: SessionStatus): Promise<WhatsAppSession> {
    return this.updateSession(id, { status });
  }

  /**
   * Ativa sessão
   */
  async activateSession(id: string): Promise<WhatsAppSession> {
    const session = await this.updateSession(id, { isActive: true });
    this.logger.log(`🟢 Sessão ativada: ${session.sessionId}`);
    return session;
  }

  /**
   * Desativa sessão
   */
  async deactivateSession(id: string): Promise<WhatsAppSession> {
    const session = await this.updateSession(id, {
      isActive: false,
      status: SessionStatus.DISCONNECTED,
    });
    this.logger.log(`🔴 Sessão desativada: ${session.sessionId}`);
    return session;
  }

  /**
   * Deleta sessão
   */
  async deleteSession(id: string): Promise<void> {
    try {
      await this.prisma.whatsAppSession.delete({
        where: { id },
      });

      this.logger.log(`🗑️ Sessão deletada: ${id}`);
    } catch (error) {
      this.logger.error('Erro ao deletar sessão:', error);
      throw new NotFoundException(`Sessão com ID '${id}' não encontrada`);
    }
  }

  /**
   * Reseta credenciais corrompidas e força novo pareamento
   */
  async resetAuthState(id: string): Promise<WhatsAppSession> {
    const session = await this.getSessionById(id);

    await this.prisma.whatsAppSession.update({
      where: { id },
      data: {
        creds: null,
        status: SessionStatus.INACTIVE,
        isActive: false,
        updatedAt: new Date(),
      },
    });

    this.logger.log(
      `🔄 Credenciais resetadas para sessão ${session.sessionId} - Requer novo QR code`,
    );

    return this.getSessionById(id);
  }

  /**
   * Atualiza credenciais da sessão
   */
  async updateCredentials(sessionId: string, creds: any): Promise<void> {
    try {
      await this.prisma.whatsAppSession.update({
        where: { sessionId },
        data: { creds },
      });

      this.logger.debug(`Credenciais atualizadas: ${sessionId}`);
    } catch (error) {
      this.logger.error('Erro ao atualizar credenciais:', error);
    }
  }

  /**
   * Atualiza last seen
   */
  async updateLastSeen(sessionId: string): Promise<void> {
    try {
      await this.prisma.whatsAppSession.update({
        where: { sessionId },
        data: { lastSeen: new Date() },
      });
    } catch (error) {
      this.logger.error('Erro ao atualizar lastSeen:', error);
    }
  }

  /**
   * Lista sessões ativas
   */
  async getActiveSessions(): Promise<WhatsAppSession[]> {
    return this.prisma.whatsAppSession.findMany({
      where: {
        isActive: true,
      },
    });
  }

  /**
   * Lista sessões conectadas
   */
  async getConnectedSessions(): Promise<WhatsAppSession[]> {
    return this.prisma.whatsAppSession.findMany({
      where: {
        status: SessionStatus.CONNECTED,
      },
    });
  }

  /**
   * Conta total de sessões
   */
  async countSessions(): Promise<number> {
    return this.prisma.whatsAppSession.count();
  }

  /**
   * Conta sessões por status
   */
  async countByStatus(): Promise<Record<SessionStatus, number>> {
    const sessions = await this.prisma.whatsAppSession.groupBy({
      by: ['status'],
      _count: true,
    });

    const result: any = {};
    sessions.forEach((item) => {
      result[item.status] = item._count;
    });

    return result;
  }
}
