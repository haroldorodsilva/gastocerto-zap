import {
  Controller,
  Post,
  Param,
  Body,
  Headers,
  HttpCode,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MultiPlatformSessionService } from '@infrastructure/sessions/core/multi-platform-session.service';
import { TelegramProvider } from '../providers/telegram.provider';
import TelegramBot from 'node-telegram-bot-api';

/**
 * TelegramWebhookController
 *
 * Recebe updates do Telegram via HTTP POST (modo webhook).
 * NÃO usa JwtAuthGuard — o Telegram precisa de acesso público.
 * Valida via X-Telegram-Bot-Api-Secret-Token header.
 *
 * Rota: POST /webhook/telegram/:sessionId
 *
 * Ativado apenas quando TELEGRAM_MODE=webhook.
 * Em modo polling (default), este endpoint não recebe tráfego.
 */
@Controller('webhook/telegram')
export class TelegramWebhookController {
  private readonly logger = new Logger(TelegramWebhookController.name);
  private readonly webhookSecret?: string;

  constructor(
    private readonly multiPlatformService: MultiPlatformSessionService,
    private readonly configService: ConfigService,
  ) {
    this.webhookSecret = this.configService.get<string>('TELEGRAM_WEBHOOK_SECRET');
  }

  @Post(':sessionId')
  @HttpCode(200)
  async handleUpdate(
    @Param('sessionId') sessionId: string,
    @Body() update: TelegramBot.Update,
    @Headers('x-telegram-bot-api-secret-token') secretToken?: string,
  ): Promise<{ ok: true }> {
    // Validar secret token se configurado
    if (this.webhookSecret && secretToken !== this.webhookSecret) {
      this.logger.warn(`🚫 Invalid webhook secret for session ${sessionId}`);
      throw new ForbiddenException('Invalid webhook secret');
    }

    // Buscar provider ativo para esta sessão
    const sessions = this.multiPlatformService.getActiveSessions();
    const session = sessions.find((s) => s.sessionId === sessionId);

    if (!session) {
      this.logger.warn(`⚠️  No active session found for webhook: ${sessionId}`);
      return { ok: true }; // Retornar 200 para Telegram não retentar
    }

    // Delegar processamento ao TelegramProvider
    const provider = session.provider as TelegramProvider;
    provider.processUpdate(update);

    return { ok: true };
  }
}
