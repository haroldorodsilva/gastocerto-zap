import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { MultiPlatformSessionService } from '@infrastructure/sessions/core/multi-platform-session.service';
import { SessionsService } from '@infrastructure/sessions/core/sessions.service';
import { WhatsAppSessionManager } from '@infrastructure/whatsapp/providers/baileys/whatsapp-session-manager.service';
import { MessageContextService } from './message-context.service';
import { MessagingPlatform } from '@infrastructure/messaging/messaging-provider.interface';
import { REPLY_EVENTS } from '@infrastructure/messaging/messaging-events.constants';

/**
 * Evento para solicitar envio de mensagem
 */
export interface SendMessageEvent {
  platformId: string; // ID da plataforma: WhatsApp (5566996285154@s.whatsapp.net) ou Telegram (707624962)
  message: string;
  context: 'INTENT_RESPONSE' | 'CONFIRMATION_REQUEST' | 'TRANSACTION_RESULT' | 'ERROR';
  platform?: MessagingPlatform; // ✨ NOVO: Plataforma de origem (telegram/whatsapp)
  sessionId?: string; // Opcional: SessionId explícito (se não fornecido, busca no contexto)
  metadata?: {
    intent?: string;
    confidence?: number;
    transactionId?: string;
    confirmationId?: string;
    action?: string;
  };
}

/**
 * MessageResponseService
 *
 * Serviço responsável por escutar eventos de resposta e enviar mensagens
 * de volta ao usuário via WhatsApp/Telegram.
 *
 * RESPONSABILIDADES:
 * - Escutar evento 'message.reply'
 * - Usar MessageContextService para obter sessão e plataforma corretas
 * - Garantir que resposta volte para a plataforma de origem
 * - Enviar mensagem via MultiPlatformSessionService
 * - Logar tentativas e falhas
 *
 * CONTEXTOS SUPORTADOS:
 * - INTENT_RESPONSE: Respostas do NLP (saudações, ajuda, não reconhecido)
 * - CONFIRMATION_REQUEST: Pedidos de confirmação de transação
 * - TRANSACTION_RESULT: Resultado de registro (sucesso/erro)
 * - ERROR: Mensagens de erro genéricas
 */
@Injectable()
export class MessageResponseService {
  private readonly logger = new Logger(MessageResponseService.name);

  constructor(
    private readonly multiPlatformService: MultiPlatformSessionService,
    private readonly sessionsService: SessionsService,
    private readonly whatsappSessionManager: WhatsAppSessionManager,
    private readonly contextService: MessageContextService,
  ) {}

  /**
   * Escuta evento 'whatsapp.reply' e envia mensagem ao usuário via WhatsApp
   */
  @OnEvent(REPLY_EVENTS.WHATSAPP)
  async handleWhatsAppReply(event: SendMessageEvent): Promise<void> {
    await this.sendReply(event, MessagingPlatform.WHATSAPP);
  }

  /**
   * Escuta evento 'telegram.reply' e envia mensagem ao usuário via Telegram
   */
  @OnEvent(REPLY_EVENTS.TELEGRAM)
  async handleTelegramReply(event: SendMessageEvent): Promise<void> {
    await this.sendReply(event, MessagingPlatform.TELEGRAM);
  }

  /**
   * Método privado que envia resposta usando contexto da plataforma
   */
  private async sendReply(
    event: SendMessageEvent,
    expectedPlatform: MessagingPlatform,
    isRetry = false,
  ): Promise<void> {
    const { platformId, message, context, metadata, sessionId, platform } = event;

    this.logger.log(
      `📤 ========== ENVIANDO RESPOSTA [${expectedPlatform.toUpperCase()}] ==========\n` +
        `🆔 PlatformId: ${platformId}\n` +
        `📱 Platform: ${platform || expectedPlatform}\n` +
        `🔗 SessionId: ${sessionId || 'N/A'}\n` +
        `🏷️  Context: ${context}\n` +
        `💬 Message: ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}\n` +
        `📊 Metadata: ${JSON.stringify(metadata || {})}`,
    );

    try {
      let targetSessionId = sessionId;
      let targetPlatform = platform || expectedPlatform;

      // 1. Se não fornecido sessionId, buscar contexto no MessageContextService
      if (!targetSessionId) {
        this.logger.debug(`🔍 Buscando contexto para ${platformId}...`);
        const messageContext = await this.contextService.getContext(platformId);

        if (messageContext) {
          targetSessionId = messageContext.sessionId;
          targetPlatform = messageContext.platform;

          // Validar se plataforma bate com evento
          if (targetPlatform !== expectedPlatform) {
            this.logger.warn(
              `⚠️  Plataforma do contexto (${targetPlatform}) difere do evento (${expectedPlatform}). Usando contexto.`,
            );
          }

          this.logger.log(
            `✅ Contexto encontrado: [${messageContext.platform}] ${messageContext.sessionId}`,
          );
        } else {
          // Fallback: buscar no banco (menos confiável)
          this.logger.debug(
            `🔍 Contexto não encontrado. Buscando sessão ativa para ${platformId}...`,
          );
          const session = await this.findActiveSession(platformId);

          if (!session) {
            this.logger.warn(
              `⚠️  Nenhuma sessão ativa encontrada para ${platformId}. Mensagem não enviada.`,
            );
            return;
          }

          targetSessionId = session.sessionId;
          targetPlatform = session.platform as MessagingPlatform;
          this.logger.log(`✅ Sessão encontrada no banco: [${targetPlatform}] ${targetSessionId}`);
        }
      }

      // 2. Validar que temos sessionId e platform
      if (!targetSessionId || !targetPlatform) {
        this.logger.error(
          `❌ Dados insuficientes para enviar mensagem: sessionId=${targetSessionId}, platform=${targetPlatform}`,
        );
        return;
      }

      // 3. Enviar mensagem via serviço correto (WhatsApp ou Telegram)
      await this.sendMessage(targetSessionId, platformId, message, targetPlatform);

      this.logger.log(
        `✅ Mensagem enviada com sucesso!\n` +
          `🆔 Para: ${platformId}\n` +
          `📱 Plataforma: ${targetPlatform}\n` +
          `🔗 Sessão: ${targetSessionId}\n` +
          `🏷️  Contexto: ${context}`,
      );
    } catch (error) {
      this.logger.error(
        `❌ Erro ao enviar mensagem:\n` +
          `🆔 PlatformId: ${platformId}\n` +
          `🏷️  Context: ${context}\n` +
          `❌ Error: ${error.message}`,
        error.stack,
      );

      // Retry automático para mensagens críticas (apenas 1 tentativa extra)
      const criticalContexts = ['CONFIRMATION_REQUEST', 'TRANSACTION_RESULT'];
      if (!isRetry && criticalContexts.includes(context)) {
        this.logger.warn(
          `🔄 Mensagem crítica falhou. Tentando reenvio em 5s...\n` +
            `🆔 PlatformId: ${platformId}\n` +
            `🏷️  Context: ${context}`,
        );

        try {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          await this.sendReply(
            { platformId, message, context, metadata, sessionId, platform } as SendMessageEvent,
            expectedPlatform,
            true,
          );
          this.logger.log(`✅ Mensagem crítica reenviada com sucesso para ${platformId}`);
        } catch (retryError) {
          this.logger.error(
            `🚨 MENSAGEM CRÍTICA NÃO ENVIADA após retry! Requer ação manual.\n` +
              `🆔 PlatformId: ${platformId}\n` +
              `🏷️  Context: ${context}\n` +
              `💬 Message: ${message}`,
          );
        }
      }
    }
  }

  /**
   * Busca sessão ativa para o platformId (fallback quando contexto não encontrado)
   * Prioriza WhatsApp, fallback para Telegram se disponível
   */
  private async findActiveSession(platformId: string): Promise<{
    sessionId: string;
    platform?: string;
  } | null> {
    try {
      // Tenta buscar sessão WhatsApp primeiro
      const whatsappSession = await this.sessionsService.getSessionByPhoneNumber(platformId);

      if (whatsappSession && whatsappSession.isActive) {
        return {
          sessionId: whatsappSession.sessionId,
          platform: 'WhatsApp',
        };
      }

      // TODO: Se não encontrar WhatsApp, tentar Telegram
      // const telegramSession = await this.sessionsService.getTelegramSessionByPhone(platformId);
      // if (telegramSession && telegramSession.isActive) {
      //   return { sessionId: telegramSession.sessionId, platform: 'Telegram' };
      // }

      return null;
    } catch (error) {
      this.logger.error(`Erro ao buscar sessão para ${platformId}:`, error);
      return null;
    }
  }

  /**
   * Envia mensagem via serviço correto (WhatsApp ou Telegram)
   */
  private async sendMessage(
    sessionId: string,
    platformId: string,
    message: string,
    platform: MessagingPlatform,
  ): Promise<void> {
    try {
      if (platform === MessagingPlatform.WHATSAPP) {
        // WhatsApp: usar WhatsAppSessionManager
        this.logger.debug(`📤 Enviando via WhatsAppSessionManager: ${sessionId} → ${platformId}`);

        // Formatar phoneNumber sem @s.whatsapp.net se necessário
        const phoneNumber = platformId.replace('@s.whatsapp.net', '');
        const success = await this.whatsappSessionManager.sendMessage(sessionId, phoneNumber, message);

        if (!success) {
          throw new Error('Failed to send WhatsApp message');
        }
      } else if (platform === MessagingPlatform.TELEGRAM) {
        // Telegram: usar MultiPlatformSessionService
        this.logger.debug(`📤 Enviando via MultiPlatformSessionService: ${sessionId} → ${platformId}`);
        await this.multiPlatformService.sendTextMessage(sessionId, platformId, message);
      } else {
        throw new Error(`Unsupported platform: ${platform}`);
      }
    } catch (error) {
      this.logger.error(
        `Erro ao enviar mensagem via ${platform === MessagingPlatform.WHATSAPP ? 'WhatsAppSessionManager' : 'MultiPlatformService'}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Método helper para emissão de evento (usado por outros serviços)
   *
   * Exemplo de uso:
   * ```typescript
   * this.eventEmitter.emit('message.reply', {
   *   phoneNumber: '5511999999999',
   *   message: 'Olá! Como posso ajudar?',
   *   context: 'INTENT_RESPONSE',
   *   metadata: { intent: 'GREETING', confidence: 0.95 }
   * });
   * ```
   */
  // Este é apenas um exemplo de documentação, o emit é feito pelos outros serviços
}
