import { Injectable, Logger } from '@nestjs/common';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { MessageFilterService } from './message-filter.service';
import { MessageContextService } from './message-context.service';
import { OnboardingService } from '@features/onboarding/onboarding.service';
import { UserCacheService } from '@features/users/user-cache.service';
import { UserRateLimiterService } from '@common/services/user-rate-limiter.service';
import { PrismaService } from '@core/database/prisma.service';
import { MessagingPlatform } from '@common/interfaces/messaging-provider.interface';
import { IFilteredMessage } from '@common/interfaces/message.interface';

/**
 * WhatsAppMessageHandler
 *
 * Handler dedicado para processar mensagens do WhatsApp via Baileys.
 * Responsável por:
 * - Escutar evento 'session.message' (WhatsApp específico)
 * - Registrar contexto de WhatsApp no MessageContextService
 * - Filtrar mensagens válidas
 * - Enfileirar para processamento assíncrono
 * - Rotear para onboarding ou transações conforme usuário
 */
@Injectable()
export class WhatsAppMessageHandler {
  private readonly logger = new Logger(WhatsAppMessageHandler.name);

  constructor(
    private readonly messageFilter: MessageFilterService,
    private readonly contextService: MessageContextService,
    private readonly onboardingService: OnboardingService,
    private readonly userCacheService: UserCacheService,
    private readonly userRateLimiter: UserRateLimiterService,
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    @InjectQueue('whatsapp-messages') private readonly messageQueue: Queue,
    @InjectQueue('transaction-confirmation') private readonly transactionQueue: Queue,
  ) {}

  /**
   * Escuta evento whatsapp.message emitido pelo SessionManager (Baileys/WhatsApp)
   * Processa mensagem e roteia para fila de processamento
   */
  @OnEvent('whatsapp.message')
  async handleIncomingMessage(payload: { sessionId: string; message: any }): Promise<void> {
    const { sessionId, message } = payload;

    try {
      this.logger.debug(
        `📨 [WhatsApp] Received message from session ${sessionId}: ${message.key.id}`,
      );

      // Filtra e extrai dados da mensagem
      const filteredMessage = await this.messageFilter.extractMessageData(message);

      if (!filteredMessage) {
        this.logger.debug(`[WhatsApp] Message filtered out: ${message.key.id}`);
        return;
      }

      const phoneNumber = filteredMessage.phoneNumber;
      this.logger.log(`✅ [WhatsApp] Processing message from ${phoneNumber}`);

      // 🆕 VERIFICAR RATE LIMITING (proteção contra spam)
      const rateLimitCheck = await this.userRateLimiter.checkLimit(phoneNumber);

      if (!rateLimitCheck.allowed) {
        this.logger.warn(
          `🚫 [WhatsApp] Rate limit exceeded for ${phoneNumber}: ${rateLimitCheck.reason} (retry after ${rateLimitCheck.retryAfter}s)`,
        );

        // Enviar mensagem de rate limit ao usuário
        const limitMessage = this.userRateLimiter.getRateLimitMessage(
          rateLimitCheck.reason!,
          rateLimitCheck.retryAfter!,
        );

        this.sendMessage(phoneNumber, limitMessage);
        return; // ❌ Bloqueia processamento
      }

      // ✅ Registrar uso da mensagem
      await this.userRateLimiter.recordUsage(phoneNumber);

      // Buscar usuário para obter userId (não bloqueante)
      const user = await this.userCacheService.getUser(phoneNumber);
      const userId = user?.gastoCertoId;

      // ✨ Registrar contexto de WhatsApp para roteamento de respostas
      this.contextService.registerContext(
        phoneNumber,
        sessionId,
        MessagingPlatform.WHATSAPP,
        userId,
        phoneNumber,
      );
      this.logger.debug(
        `📝 Contexto registrado: WhatsApp [${phoneNumber}] → ${sessionId}` +
          (userId ? ` | userId: ${userId}` : ''),
      );

      // Enfileira mensagem para processamento assíncrono
      await this.messageQueue.add('process-message', {
        sessionId,
        message: filteredMessage,
        timestamp: Date.now(),
        platform: 'whatsapp', // ✅ Incluir plataforma
        userId, // ✅ Incluir userId para rastreabilidade
      });

      this.logger.debug(`[WhatsApp] Message ${filteredMessage.messageId} added to queue`);
    } catch (error) {
      this.logger.error(
        `[WhatsApp] Error handling message from session ${sessionId}: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Processa mensagem da fila (chamado pelo MessagesProcessor)
   * Verifica usuário e roteia para onboarding ou transações
   */
  async processMessage(data: {
    sessionId: string;
    message: IFilteredMessage;
    timestamp: number;
  }): Promise<void> {
    const { sessionId, message } = data;
    const phoneNumber = message.phoneNumber;

    try {
      this.logger.log(
        `🔄 [WhatsApp] Processing queued message from ${phoneNumber} (${message.type})`,
      );

      // 1. PRIMEIRO: Verificar se está em processo de onboarding (ANTES de verificar usuário)
      // Isso evita o loop de verificação de usuário não existente
      const isOnboarding = await this.onboardingService.isUserOnboarding(phoneNumber);
      if (isOnboarding) {
        this.logger.log(`[WhatsApp] 📝 User ${phoneNumber} is in onboarding - processing message`);
        await this.handleOnboardingMessage(message);
        return;
      }

      // 2. Buscar usuário no cache/API (com isBlocked e isActive)
      const user = await this.userCacheService.getUser(phoneNumber);

      // 🐛 DEBUG: Logar status do usuário
      this.logger.log(
        `[WhatsApp] 🔍 User status for ${phoneNumber}:`,
        JSON.stringify({
          found: !!user,
          isBlocked: user?.isBlocked,
          isActive: user?.isActive,
          hasActiveSubscription: user?.hasActiveSubscription,
          gastoCertoId: user?.gastoCertoId,
        }),
      );

      // 3. Se usuário não existe, iniciar onboarding
      if (!user) {
        this.logger.log(`[WhatsApp] New user detected: ${phoneNumber}, starting onboarding`);
        await this.onboardingService.startOnboarding(phoneNumber, 'whatsapp');
        return;
      }

      // 4. ❗ CRÍTICO: Verificar se usuário está bloqueado (PRIORIDADE MÁXIMA)
      if (user.isBlocked) {
        this.logger.warn(`[WhatsApp] ❌ User ${phoneNumber} is BLOCKED - Rejecting message`);
        this.sendMessage(
          phoneNumber,
          '🚫 *Acesso Bloqueado*\n\n' +
            'Sua conta foi bloqueada temporariamente.\n\n' +
            '📞 Entre em contato com o suporte para mais informações:\n' +
            'suporte@gastocerto.com',
        );
        return;
      }

      // 5. Verificar se usuário está inativo → Iniciar reativação
      if (!user.isActive) {
        this.logger.log(
          `[WhatsApp] 🔄 User ${phoneNumber} is INACTIVE - Starting reactivation process`,
        );
        await this.onboardingService.reactivateUser(phoneNumber, 'whatsapp');
        return;
      }

      // 6. Verificar assinatura ativa
      if (!user.hasActiveSubscription) {
        this.logger.warn(`[WhatsApp] User ${phoneNumber} has no active subscription`);
        this.sendMessage(
          phoneNumber,
          '💳 *Assinatura Inativa*\n\n' +
            'Sua assinatura expirou ou está inativa.\n\n' +
            '🔄 Para continuar usando o GastoCerto, renove sua assinatura:\n' +
            '👉 https://gastocerto.com/assinatura\n\n' +
            '❓ Dúvidas? Fale conosco: suporte@gastocerto.com',
        );
        return;
      }

      // 7. Usuário válido - verificar se é confirmação de transação pendente
      const pendingConfirmation = await this.checkPendingConfirmation(phoneNumber, message.text);

      if (pendingConfirmation) {
        this.logger.log(`[WhatsApp] Processing transaction confirmation for ${phoneNumber}`);

        // Enfileirar resposta de confirmação
        await this.transactionQueue.add('process-confirmation', {
          phoneNumber,
          response: message.text,
          confirmationId: pendingConfirmation.id,
          timestamp: Date.now(),
        });

        return;
      }

      // 8. Não é confirmação - processar como nova transação
      this.logger.log(`[WhatsApp] Processing new transaction for user ${user.name}`);

      // Enfileirar na fila de confirmação de transações
      await this.transactionQueue.add('create-confirmation', {
        userId: user.gastoCertoId,
        phoneNumber,
        message,
        timestamp: Date.now(),
      });

      this.logger.log(`[WhatsApp] Message queued for transaction processing`);
    } catch (error) {
      this.logger.error(
        `[WhatsApp] Error processing message from ${phoneNumber}: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Processa mensagem durante onboarding
   * USA EVENTOS GENÉRICOS (padrão unificado WhatsApp/Telegram)
   */
  private async handleOnboardingMessage(message: IFilteredMessage): Promise<void> {
    this.logger.log(`📝 [WhatsApp] Processing onboarding message`);

    if (message.type !== 'text' || !message.text) {
      // Onboarding aceita apenas texto
      return;
    }

    try {
      // Usar handleMessage() que emite eventos automaticamente
      await this.onboardingService.handleMessage(message);
    } catch (error) {
      this.logger.error(
        `[WhatsApp] Error processing onboarding for ${message.phoneNumber}:`,
        error,
      );
    }
  }

  /**
   * Envia mensagem ao usuário via WhatsApp
   */
  private sendMessage(phoneNumber: string, message: string): void {
    this.logger.debug(`📤 Enviando mensagem para ${phoneNumber}`);

    this.eventEmitter.emit('whatsapp.reply', {
      platformId: phoneNumber,
      message,
      context: 'ERROR',
      platform: MessagingPlatform.WHATSAPP,
    });
  }

  /**
   * Verifica se usuário tem confirmação de transação pendente
   */
  private async checkPendingConfirmation(
    phoneNumber: string,
    text: string,
  ): Promise<{ id: string } | null> {
    try {
      // Buscar confirmação pendente nos últimos 5 minutos
      const confirmation = await this.prisma.transactionConfirmation.findFirst({
        where: {
          phoneNumber,
          status: 'PENDING',
          createdAt: {
            gte: new Date(Date.now() - 5 * 60 * 1000), // 5 minutos
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!confirmation) return null;

      // Verificar se mensagem é resposta de confirmação (sim/não)
      const normalized = text.toLowerCase().trim();
      const confirmationWords = [
        'sim',
        's',
        'confirmar',
        'ok',
        'confirmo',
        'yes',
        'não',
        'n',
        'nao',
        'cancelar',
        'cancel',
        'no',
      ];

      const isConfirmationResponse = confirmationWords.some((word) => normalized.includes(word));

      return isConfirmationResponse ? { id: confirmation.id } : null;
    } catch (error) {
      this.logger.error(`Error checking pending confirmation: ${error.message}`);
      return null;
    }
  }
}
