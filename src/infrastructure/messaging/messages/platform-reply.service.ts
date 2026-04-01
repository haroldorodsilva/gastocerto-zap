import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MessageContextService } from './message-context.service';
import { MessagingPlatform } from '../messaging-provider.interface';
import { REPLY_EVENTS } from '../messaging-events.constants';

export interface PlatformReplyOptions {
  platformId: string;
  message: string;
  context: string;
  platform?: MessagingPlatform | string;
  metadata?: Record<string, any>;
  imageBuffer?: Buffer;
}

/**
 * Serviço centralizado para emissão de respostas para a plataforma correta.
 *
 * Substitui o padrão duplicado em 6+ arquivos:
 *   const eventName = platform === 'telegram' ? 'telegram.reply' : 'whatsapp.reply';
 *   this.eventEmitter.emit(eventName, { platformId, message, context, platform });
 *
 * Funcionalidades:
 * - Resolução automática de plataforma via MessageContextService
 * - Guard para WebChat (responde via HTTP, não emite evento)
 * - Mapeamento padronizado de platform → event name
 */
@Injectable()
export class PlatformReplyService {
  private readonly logger = new Logger(PlatformReplyService.name);

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly contextService: MessageContextService,
  ) {}

  /**
   * Envia resposta para a plataforma correta do usuário.
   *
   * Se `platform` não for fornecido, busca no MessageContextService.
   * WebChat é ignorado (responde via HTTP).
   */
  async sendReply(options: PlatformReplyOptions): Promise<void> {
    const { platformId, message, context, metadata } = options;
    let platform = options.platform as MessagingPlatform | undefined;

    // Resolver plataforma se não fornecida
    if (!platform) {
      const messageContext = await this.contextService.getContext(platformId);
      platform = messageContext?.platform || MessagingPlatform.WHATSAPP;
    }

    // Normalizar string para enum
    const normalizedPlatform = this.normalizePlatform(platform);

    // WebChat responde via HTTP — não emitir evento
    if (normalizedPlatform === MessagingPlatform.WEBCHAT) {
      this.logger.debug(`📤 [webchat] Skipping event emission for ${platformId} (HTTP response)`);
      return;
    }

    // Mapear plataforma para evento correto
    const eventName =
      normalizedPlatform === MessagingPlatform.TELEGRAM
        ? REPLY_EVENTS.TELEGRAM
        : REPLY_EVENTS.WHATSAPP;

    this.logger.debug(`📤 [${normalizedPlatform}] Sending reply to ${platformId} (${context})`);

    this.eventEmitter.emit(eventName, {
      platformId,
      message,
      context,
      metadata,
      platform: normalizedPlatform,
      imageBuffer: options.imageBuffer,
    });
  }

  /**
   * Normaliza string de plataforma para MessagingPlatform enum
   */
  private normalizePlatform(platform: string | MessagingPlatform): MessagingPlatform {
    const normalized = String(platform).toLowerCase();
    switch (normalized) {
      case 'telegram':
        return MessagingPlatform.TELEGRAM;
      case 'webchat':
        return MessagingPlatform.WEBCHAT;
      case 'whatsapp':
      default:
        return MessagingPlatform.WHATSAPP;
    }
  }
}
