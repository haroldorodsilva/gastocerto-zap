import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Body,
  Logger,
  HttpCode,
  HttpStatus,
  UseGuards,
  HttpException,
  Put,
} from '@nestjs/common';
import { MultiPlatformSessionService } from '@infrastructure/messaging/core/services/multi-platform-session.service';
import { TelegramSessionsService } from '../providers/telegram-sessions.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { CreateTelegramSessionDto } from '@infrastructure/messaging/core/dto/session.dto';
import { TelegramSession } from '@prisma/client';

/**
 * TelegramController
 * Gerenciamento de sessões Telegram (segue mesmo padrão do WhatsApp)
 *
 * Autenticação: JwtAuthGuard
 * - Apenas admin (gastocerto-admin): Authorization: Bearer <jwt>
 * - Requer role ADMIN ou MASTER
 */
@Controller('telegram')
@UseGuards(JwtAuthGuard)
export class TelegramController {
  private readonly logger = new Logger(TelegramController.name);

  constructor(
    private readonly multiPlatformService: MultiPlatformSessionService,
    private readonly telegramSessionsService: TelegramSessionsService,
  ) {}

  /**
   * Cria sessão Telegram
   * POST /telegram
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createSession(@Body() dto: CreateTelegramSessionDto): Promise<TelegramSession> {
    return this.telegramSessionsService.create(dto);
  }

  /**
   * Lista todas as sessões Telegram
   * GET /telegram
   */
  @Get()
  async listSessions(): Promise<TelegramSession[]> {
    return this.telegramSessionsService.findAll();
  }

  /**
   * Busca sessão Telegram por ID
   * GET /telegram/:id
   */
  @Get(':id')
  async getSession(@Param('id') id: string): Promise<TelegramSession> {
    return this.telegramSessionsService.findById(id);
  }

  /**
   * Atualiza sessão Telegram
   * PUT /telegram/:id
   */
  @Put(':id')
  @HttpCode(HttpStatus.OK)
  async updateSession(
    @Param('id') id: string,
    @Body() dto: { name?: string; token?: string },
  ): Promise<TelegramSession> {
    return this.telegramSessionsService.update(id, dto);
  }

  /**
   * Ativa sessão Telegram (inicia bot)
   * POST /telegram/:id/activate
   */
  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  async activateSession(@Param('id') id: string): Promise<TelegramSession> {
    this.logger.log(`🚀 Activating Telegram session: ${id}`);

    try {
      const session = await this.telegramSessionsService.findById(id);
      await this.multiPlatformService.startTelegramSession(session.sessionId);
      return this.telegramSessionsService.findById(id);
    } catch (error) {
      this.logger.error(`Failed to activate Telegram session ${id}:`, error.message);
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_REQUEST,
          message: error.message || 'Failed to activate Telegram session',
          error: 'Bad Request',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Desativa sessão Telegram (para bot)
   * POST /telegram/:id/deactivate
   */
  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  async deactivateSession(@Param('id') id: string): Promise<TelegramSession> {
    this.logger.log(`🔴 Deactivating Telegram session: ${id}`);

    const session = await this.telegramSessionsService.findById(id);
    await this.multiPlatformService.stopSession(session.sessionId);
    return this.telegramSessionsService.findById(id);
  }

  /**
   * Força reconexão de uma sessão após desativar todas as outras com mesmo token
   * POST /telegram/:id/force-reconnect
   * 
   * Use este endpoint quando tiver erro 409 (múltiplas instâncias).
   * Ele desativa todas as outras sessões com o mesmo token e ativa apenas esta.
   */
  @Post(':id/force-reconnect')
  @HttpCode(HttpStatus.OK)
  async forceReconnect(@Param('id') id: string): Promise<{
    success: boolean;
    deactivatedSessions: string[];
    activatedSession: TelegramSession;
  }> {
    this.logger.log(`🔄 Force reconnect Telegram session: ${id}`);

    try {
      const targetSession = await this.telegramSessionsService.findById(id);
      
      if (!targetSession.token) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message: 'Session has no token configured',
            error: 'Bad Request',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      // 1. Buscar todas as sessões com o mesmo token (exceto a target)
      const sessionsWithSameToken = await this.telegramSessionsService.findByToken(
        targetSession.token,
        id, // exclude this ID
      );

      const deactivatedSessionIds: string[] = [];

      // 2. Desativar todas as outras sessões com o mesmo token
      for (const session of sessionsWithSameToken) {
        this.logger.log(`🔴 Deactivating conflicting session: ${session.id} (${session.name})`);
        
        try {
          // Parar a sessão se estiver ativa
          await this.multiPlatformService.stopSession(session.sessionId);
        } catch (error) {
          this.logger.warn(`Could not stop session ${session.sessionId}: ${error.message}`);
        }

        deactivatedSessionIds.push(session.id);
      }

      // 3. Garantir que a sessão target está parada antes de reativar
      try {
        await this.multiPlatformService.stopSession(targetSession.sessionId);
      } catch (error) {
        this.logger.warn(`Could not stop target session: ${error.message}`);
      }

      // 4. Ativar a sessão target
      this.logger.log(`🚀 Activating target session: ${id}`);
      await this.multiPlatformService.startTelegramSession(targetSession.sessionId);

      const updatedSession = await this.telegramSessionsService.findById(id);

      return {
        success: true,
        deactivatedSessions: deactivatedSessionIds,
        activatedSession: updatedSession,
      };
    } catch (error) {
      this.logger.error(`Failed to force reconnect session ${id}:`, error.message);
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: error.message || 'Failed to force reconnect session',
          error: 'Internal Server Error',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Deleta sessão Telegram
   * DELETE /telegram/:id
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSession(@Param('id') id: string): Promise<void> {
    this.logger.log(`Deleting Telegram session: ${id}`);
    await this.telegramSessionsService.delete(id);
  }
}
