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
import { MultiPlatformSessionService } from '@infrastructure/sessions/core/multi-platform-session.service';
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

      if (!session.token) {
        throw new HttpException(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message:
              'Token do bot não configurado. Atualize a sessão com um token válido do @BotFather',
            error: 'Token Ausente',
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      // 🆕 Desativar todas as outras sessões com o mesmo token (prevenir erro 409)
      const sessionsWithSameToken = await this.telegramSessionsService.findByToken(
        session.token,
        id, // exclude this ID
      );

      if (sessionsWithSameToken.length > 0) {
        this.logger.log(
          `🔴 Desativando ${sessionsWithSameToken.length} sessão(ões) conflitante(s) com o mesmo token...`,
        );

        for (const conflictingSession of sessionsWithSameToken) {
          this.logger.log(
            `🔴 Desativando sessão conflitante: ${conflictingSession.id} (${conflictingSession.name})`,
          );

          try {
            // Parar a sessão se estiver ativa
            await this.multiPlatformService.stopSession(conflictingSession.sessionId);
          } catch (error: any) {
            this.logger.warn(
              `Could not stop session ${conflictingSession.sessionId}: ${error.message}`,
            );
          }
        }

        // Aguardar um pouco para garantir que tudo foi desconectado
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      // Iniciar a sessão target
      await this.multiPlatformService.startTelegramSession(session.sessionId);
      return this.telegramSessionsService.findById(id);
    } catch (error: any) {
      this.logger.error(`Failed to activate Telegram session ${id}:`, error.message);

      // Mensagem de erro mais específica baseada no tipo de erro
      let errorMessage = error.message || 'Erro ao ativar sessão do Telegram';
      let errorType = 'Erro de Ativação';
      let statusCode = HttpStatus.BAD_REQUEST;

      // Detectar erros específicos
      if (errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
        errorMessage =
          'Token do bot inválido. Verifique o token no @BotFather e atualize a sessão.';
        errorType = 'Token Inválido';
      } else if (errorMessage.includes('409') || errorMessage.includes('Conflict')) {
        errorMessage =
          'Bot já está sendo usado em outra instância. Use o endpoint /force-reconnect para resolver.';
        errorType = 'Conflito de Instâncias';
        statusCode = HttpStatus.CONFLICT;
      } else if (errorMessage.includes('token not found')) {
        errorMessage = 'Token do bot não encontrado. Configure o token antes de ativar.';
        errorType = 'Token Não Encontrado';
      } else if (errorMessage.includes('network') || errorMessage.includes('timeout')) {
        errorMessage = 'Erro de conexão com o Telegram. Verifique a internet e tente novamente.';
        errorType = 'Erro de Conexão';
        statusCode = HttpStatus.SERVICE_UNAVAILABLE;
      }

      throw new HttpException(
        {
          statusCode,
          message: errorMessage,
          error: errorType,
          details: error.message,
        },
        statusCode,
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
