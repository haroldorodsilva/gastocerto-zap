import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '@core/database/prisma.service';
import { TelegramSession, SessionStatus } from '@prisma/client';

export interface CreateTelegramSessionDto {
  name: string;
  token: string;
}

export interface UpdateTelegramSessionDto {
  name?: string;
  token?: string;
  status?: SessionStatus;
  isActive?: boolean;
}

@Injectable()
export class TelegramSessionsService {
  private readonly logger = new Logger(TelegramSessionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cria nova sessão Telegram
   */
  async create(dto: CreateTelegramSessionDto): Promise<TelegramSession> {
    const sessionId = `telegram-${Date.now()}`;

    this.logger.log(`Creating Telegram session: ${sessionId} (${dto.name})`);

    return this.prisma.telegramSession.create({
      data: {
        sessionId,
        name: dto.name,
        token: dto.token,
        status: SessionStatus.INACTIVE,
        isActive: true,
      },
    });
  }

  /**
   * Lista todas as sessões Telegram
   */
  async findAll(): Promise<TelegramSession[]> {
    return this.prisma.telegramSession.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Busca sessão por ID
   */
  async findById(id: string): Promise<TelegramSession> {
    const session = await this.prisma.telegramSession.findUnique({
      where: { id },
    });

    if (!session) {
      throw new NotFoundException(`Telegram session ${id} not found`);
    }

    return session;
  }

  /**
   * Busca sessão por sessionId
   */
  async findBySessionId(sessionId: string): Promise<TelegramSession> {
    const session = await this.prisma.telegramSession.findUnique({
      where: { sessionId },
    });

    if (!session) {
      throw new NotFoundException(`Telegram session ${sessionId} not found`);
    }

    return session;
  }

  /**
   * Atualiza sessão
   */
  async update(id: string, dto: UpdateTelegramSessionDto): Promise<TelegramSession> {
    await this.findById(id); // Verifica se existe

    return this.prisma.telegramSession.update({
      where: { id },
      data: dto,
    });
  }

  /**
   * Deleta sessão
   */
  async delete(id: string): Promise<void> {
    await this.findById(id); // Verifica se existe

    await this.prisma.telegramSession.delete({
      where: { id },
    });

    this.logger.log(`Telegram session ${id} deleted`);
  }

  /**
   * Atualiza status da sessão
   */
  async updateStatus(sessionId: string, status: SessionStatus): Promise<void> {
    await this.prisma.telegramSession.update({
      where: { sessionId },
      data: { status, lastSeen: new Date() },
    });
  }

  /**
   * Ativa sessão
   */
  async activate(id: string): Promise<TelegramSession> {
    return this.update(id, {
      isActive: true,
      status: SessionStatus.CONNECTING,
    });
  }

  /**
   * Desativa sessão
   */
  async deactivate(id: string): Promise<TelegramSession> {
    return this.update(id, {
      isActive: false,
      status: SessionStatus.DISCONNECTED,
    });
  }
}
