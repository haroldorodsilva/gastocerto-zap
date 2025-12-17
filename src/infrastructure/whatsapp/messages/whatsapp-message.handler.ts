import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { MessageFilterService } from './message-filter.service';
import { MessageContextService } from './message-context.service';
import { OnboardingService } from '@features/onboarding/onboarding.service';
import { UserCacheService } from '@features/users/user-cache.service';
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
    private readonly prisma: PrismaService,
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

      // 1. Verificar se usuário está em onboarding
      const isOnboarding = await this.onboardingService.isUserOnboarding(phoneNumber);

      if (isOnboarding) {
        this.logger.log(`[WhatsApp] User ${phoneNumber} is in onboarding`);
        await this.handleOnboardingMessage(message);
        return;
      }

      // 2. Buscar usuário no cache/API
      const user = await this.userCacheService.getUser(phoneNumber);

      if (!user) {
        // Usuário não encontrado - pode ser novo, encaminhar para onboarding
        this.logger.log(`[WhatsApp] New user detected: ${phoneNumber}, starting onboarding`);
        await this.onboardingService.startOnboarding(phoneNumber, 'whatsapp');
        return;
      }

      // 3. Verificar se usuário está bloqueado
      if (user.isBlocked) {
        this.logger.warn(`[WhatsApp] User ${phoneNumber} is blocked`);
        // TODO: Enviar mensagem informando que o usuário está bloqueado
        return;
      }

      // 4. Verificar se usuário está ativo
      if (!user.isActive) {
        this.logger.warn(`[WhatsApp] User ${phoneNumber} is inactive`);
        // TODO: Enviar mensagem informando que a conta está desativada
        return;
      }

      // 5. Verificar assinatura ativa
      if (!user.hasActiveSubscription) {
        this.logger.warn(`[WhatsApp] User ${phoneNumber} has no active subscription`);
        // TODO: Enviar mensagem sobre renovação
        return;
      }

      // 6. Usuário válido - verificar se é confirmação de transação pendente
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

      // 7. Não é confirmação - processar como nova transação
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
