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
import { IFilteredMessage, MessageType } from '@common/interfaces/message.interface';
import {
  MessageValidationService,
  ValidationAction,
} from '@features/messages/message-validation.service';
import { TransactionsService } from '@features/transactions/transactions.service';

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
    private readonly transactionsService: TransactionsService,
    private readonly userCacheService: UserCacheService,
    private readonly userRateLimiter: UserRateLimiterService,
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly messageValidation: MessageValidationService,
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
      // 📱 LOG INICIAL - Mostra SEMPRE de quem veio a mensagem ANTES de qualquer filtro
      const remoteJid = message.key.remoteJid;
      const senderPhone = remoteJid?.split('@')[0] || 'unknown';
      const messageId = message.key.id;

      // Ignorar mensagens de broadcast/status (status@broadcast) silenciosamente
      if (remoteJid === 'status@broadcast') {
        return;
      }

      this.logger.log(
        `📱 [WhatsApp] RAW MESSAGE | Session: ${sessionId} | From: ${senderPhone} | MessageId: ${messageId} | RemoteJid: ${remoteJid}`,
      );

      this.logger.debug(
        `📨 [WhatsApp] Received message from session ${sessionId}: ${message.key.id}`,
      );

      // Filtra e extrai dados da mensagem
      const filteredMessage = await this.messageFilter.extractMessageData(message);

      if (!filteredMessage) {
        this.logger.debug(
          `🚫 [WhatsApp] Message FILTERED OUT | From: ${senderPhone} | MessageId: ${messageId}`,
        );
        return;
      }

      // Ignorar mensagens enviadas por nós mesmos (evita loop infinito)
      if (filteredMessage.isFromMe) {
        this.logger.debug(`🚫 [WhatsApp] Ignoring self-sent message | MessageId: ${messageId}`);
        return;
      }

      const phoneNumber = filteredMessage.phoneNumber;
      this.logger.log(`✅ [WhatsApp] Processing message from ${phoneNumber}`);
      this.logger.log(`✅ [WhatsApp] message: ${JSON.stringify(filteredMessage)}`);

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

      // ✨ NOVO: Usar MessageValidationService para validação unificada
      const validation = await this.messageValidation.validateUser(phoneNumber, 'whatsapp');

      // Tratar ações conforme resultado da validação
      switch (validation.action) {
        case ValidationAction.ONBOARDING:
          // Usuário está em onboarding - processar mensagem
          this.logger.log(`[WhatsApp] 📝 User ${phoneNumber} is in onboarding`);
          await this.handleOnboardingMessage(message);
          return;

        case ValidationAction.START_ONBOARDING:
          // Novo usuário - iniciar onboarding
          this.logger.log(`[WhatsApp] ⭐ Starting onboarding for new user ${phoneNumber}`);
          const welcomeMessage = await this.messageValidation.startOnboarding(
            phoneNumber,
            'whatsapp',
          );
          if (welcomeMessage) {
            this.sendMessage(phoneNumber, welcomeMessage);
          }
          return;

        case ValidationAction.BLOCKED:
          // Usuário bloqueado
          this.logger.warn(`[WhatsApp] ❌ User ${phoneNumber} is BLOCKED`);
          this.sendMessage(phoneNumber, validation.message!);
          return;

        case ValidationAction.INACTIVE:
          // Usuário inativo - reativar
          this.logger.log(`[WhatsApp] 🔄 Reactivating user ${phoneNumber}`);
          await this.onboardingService.reactivateUser(phoneNumber, 'whatsapp');
          return;

        case ValidationAction.NO_SUBSCRIPTION:
          // Sem assinatura ativa
          this.logger.warn(`[WhatsApp] 💳 User ${phoneNumber} has no subscription`);
          this.sendMessage(phoneNumber, validation.message!);
          return;

        case ValidationAction.LEARNING_PENDING:
          // Aprendizado pendente
          this.logger.log(`[WhatsApp] 🎓 Processing learning for ${phoneNumber}`);
          const learningResult = await this.messageValidation.processLearning(
            phoneNumber,
            message.text,
            message.messageId,
            validation.user!,
            'whatsapp',
          );

          if (learningResult.success) {
            this.sendMessage(phoneNumber, learningResult.message);
          }
          return;

        case ValidationAction.PROCEED:
          // Usuário válido - prosseguir com processamento normal
          this.logger.log(`[WhatsApp] ✅ Processing message for user ${validation.user!.name}`);
          break;

        default:
          this.logger.warn(`[WhatsApp] Unknown validation action: ${validation.action}`);
          return;
      }

      // Continuar com fluxo normal de transações
      const user = validation.user!;

      // Verificar se é confirmação de transação pendente
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

      // Não é confirmação - processar como nova transação
      this.logger.log(`[WhatsApp] Processing new transaction for user ${user.name}`);

      const accountId = user.activeAccountId; // Usar accountId do cache do usuário

      // 🆕 NOVO: Processar por tipo de mensagem (igual Telegram)
      switch (message.type) {
        case MessageType.TEXT:
          // Texto: enfileirar para processamento assíncrono
          this.logger.log(`[WhatsApp] Queueing text message for processing`);
          await this.transactionQueue.add('create-confirmation', {
            userId: user.gastoCertoId,
            phoneNumber,
            message,
            timestamp: Date.now(),
            accountId, // Incluir accountId na fila
          });
          break;

        case MessageType.IMAGE:
          // Imagem: processar diretamente via IA
          if (message.imageBuffer) {
            this.logger.log(`[WhatsApp] Processing image message directly`);
            await this.transactionsService.processImageMessage(
              user, // Passar objeto user completo
              message.imageBuffer,
              message.mimeType || 'image/jpeg',
              message.messageId,
              'whatsapp',
              phoneNumber, // platformId
              accountId, // Passar accountId do cache
            );
          } else {
            this.logger.warn(`[WhatsApp] Image message without buffer`);
          }
          break;

        case MessageType.AUDIO:
          // Áudio: processar diretamente via IA
          if (message.audioBuffer) {
            this.logger.log(`[WhatsApp] Processing audio message directly`);
            await this.transactionsService.processAudioMessage(
              user, // Passar objeto user completo
              message.audioBuffer,
              message.mimeType || 'audio/ogg',
              message.messageId,
              'whatsapp',
              phoneNumber, // platformId
              accountId, // Passar accountId do cache
            );
          } else {
            this.logger.warn(`[WhatsApp] Audio message without buffer`);
          }
          break;

        default:
          this.logger.warn(`[WhatsApp] Unsupported message type: ${message.type}`);
          this.sendMessage(
            phoneNumber,
            '❌ Tipo de mensagem não suportado.\n\n' +
              'Envie:\n' +
              '• Texto: "Gastei 50 reais em alimentação"\n' +
              '• Foto de nota fiscal\n' +
              '• Áudio descrevendo o gasto',
          );
      }

      this.logger.log(`[WhatsApp] Message processed successfully`);
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
