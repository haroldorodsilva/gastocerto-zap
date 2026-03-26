import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { fireAndForget } from '@common/utils/with-retry';
import {
  MessagingPlatform,
  IncomingMessage,
  MessageType,
} from '@infrastructure/messaging/messaging-provider.interface';
import { OnboardingService } from '@features/onboarding/onboarding.service';
import { TransactionsService } from '@features/transactions/transactions.service';
import { MultiPlatformSessionService } from '@infrastructure/sessions/core/multi-platform-session.service';
import { MessageContextService } from '../message-context.service';
import { PlatformReplyService } from '../platform-reply.service';
import { IFilteredMessage } from '@infrastructure/messaging/message.interface';
import { UserCacheService } from '@features/users/user-cache.service';
import { UserRateLimiterService } from '@common/services/user-rate-limiter.service';
import { UserCache } from '@prisma/client';
import {
  MessageValidationService,
  ValidationAction,
} from '@features/messages/message-validation.service';
import { MESSAGE_EVENTS } from '@infrastructure/messaging/messaging-events.constants';

interface MessageReceivedEvent {
  sessionId: string;
  platform: MessagingPlatform;
  message: IncomingMessage;
}

@Injectable()
export class TelegramMessageHandler {
  private readonly logger = new Logger(TelegramMessageHandler.name);

  constructor(
    private readonly onboardingService: OnboardingService,
    private readonly transactionsService: TransactionsService,
    private readonly multiPlatformService: MultiPlatformSessionService,
    private readonly contextService: MessageContextService,
    private readonly platformReply: PlatformReplyService,
    private readonly userCacheService: UserCacheService,
    private readonly userRateLimiter: UserRateLimiterService,
    private readonly messageValidation: MessageValidationService,
  ) {}

  @OnEvent(MESSAGE_EVENTS.TELEGRAM)
  async handleMessage(event: MessageReceivedEvent): Promise<void> {
    this.logger.log('🔔 Event telegram.message captured!');

    // Processar apenas mensagens do Telegram
    if (event.platform !== MessagingPlatform.TELEGRAM) {
      this.logger.log(`⏭️  Ignoring non-Telegram message (platform: ${event.platform})`);
      return;
    }

    const { sessionId, message } = event;
    const userId = message.chatId;

    this.logger.log(
      `Processing Telegram message from ${message.userId} (chat: ${message.chatId}), type: ${message.type}`,
    );

    try {
      // 🆕 VERIFICAR RATE LIMITING (proteção contra spam)
      const rateLimitCheck = await this.userRateLimiter.checkLimit(userId);

      if (!rateLimitCheck.allowed) {
        this.logger.warn(
          `🚫 [Telegram] Rate limit exceeded for ${userId}: ${rateLimitCheck.reason} (retry after ${rateLimitCheck.retryAfter}s)`,
        );
        const limitMessage = this.userRateLimiter.getRateLimitMessage(
          rateLimitCheck.reason!,
          rateLimitCheck.retryAfter!,
        );
        await this.platformReply.sendReply({
          platformId: userId,
          message: limitMessage,
          context: 'ERROR',
          platform: MessagingPlatform.TELEGRAM,
        });
        return;
      }

      // ✅ Registrar uso da mensagem
      await this.userRateLimiter.recordUsage(userId);

      // Buscar usuário cadastrado para obter gastoCertoId e phoneNumber
      let gastoCertoId: string | undefined;
      let phoneNumber: string | undefined;

      try {
        const userCache = await this.userCacheService.getUserByTelegram(userId);
        if (userCache) {
          gastoCertoId = userCache.gastoCertoId;
          phoneNumber = userCache.phoneNumber;
          this.logger.debug(`✅ Usuário encontrado: ${gastoCertoId} (phone: ${phoneNumber})`);
        } else {
          this.logger.debug(`Usuário ainda não cadastrado: ${userId}`);
        }
      } catch (error) {
        this.logger.debug(`Erro ao buscar usuário: ${userId}`, error);
      }

      // Registrar contexto da plataforma para roteamento de respostas
      await this.contextService.registerContext(
        userId,
        sessionId,
        MessagingPlatform.TELEGRAM,
        gastoCertoId,
        phoneNumber,
      );

      // Processar mensagem de forma assíncrona (não bloqueia o event loop)
      fireAndForget(
        () => this.processMessage({
          sessionId,
          message,
          timestamp: Date.now(),
          platform: 'telegram',
          userId: gastoCertoId,
        }),
        { label: `telegram:${userId}` },
      );
    } catch (error) {
      this.logger.error(`Error processing Telegram message:`, error);
      await this.sendErrorMessage(sessionId, userId);
    }
  }

  /**
   * Processa mensagem da fila (chamado pelo TelegramMessagesProcessor)
   * Verifica usuário e roteia para onboarding ou transações
   */
  async processMessage(data: {
    sessionId: string;
    message: IncomingMessage;
    timestamp: number;
    platform: string;
    userId?: string;
  }): Promise<void> {
    const { sessionId, message } = data;
    const userId = message.chatId;

    try {
      // Usar MessageValidationService para validação unificada
      const validation = await this.messageValidation.validateUser(userId, 'telegram');

      // 🔄 SINCRONIZAÇÃO: Forçar sync se timer expirou OU se assinatura/canUseGastoZap está inativa
      // (mesmo comportamento do WebChat — atualiza cache desatualizado imediatamente)
      const needsSubscriptionSync =
        validation.user &&
        (
          this.userCacheService.needsSync(validation.user) ||
          !validation.user.canUseGastoZap ||
          !validation.user.hasActiveSubscription
        );

      if (needsSubscriptionSync && validation.user) {
        const syncReason = !validation.user.canUseGastoZap
          ? 'canUseGastoZap=false'
          : !validation.user.hasActiveSubscription
          ? 'hasActiveSubscription=false'
          : 'timer expirado';
        this.logger.log(`⏰ [Telegram] Sincronizando assinatura para ${userId} (motivo: ${syncReason})`);
        await this.userCacheService.syncSubscriptionStatus(validation.user.gastoCertoId);

        // Revalidar usuário com dados atualizados
        const updatedValidation = await this.messageValidation.validateUser(userId, 'telegram');

        // Bloquear se ação for NO_SUBSCRIPTION OU se os flags ainda indicam sem acesso
        // (cobre casos onde a chave de cache do Telegram não foi atualizada pelo sync)
        const blockedAfterSync =
          updatedValidation.action === ValidationAction.NO_SUBSCRIPTION ||
          !updatedValidation.user?.canUseGastoZap ||
          !updatedValidation.user?.hasActiveSubscription;

        if (blockedAfterSync) {
          this.logger.warn(`[Telegram] 💳 Acesso negado após sync: ${userId} (hasActiveSubscription=${updatedValidation.user?.hasActiveSubscription}, canUseGastoZap=${updatedValidation.user?.canUseGastoZap})`);
          await this.platformReply.sendReply({
            platformId: userId,
            message: updatedValidation.user?.hasActiveSubscription
              ? '💳 Seu plano atual não inclui o GastoZap. Faça upgrade para usar esse recurso.'
              : '💳 Sua assinatura não está ativa. Renove para continuar usando o serviço.',
            context: 'ERROR',
            platform: MessagingPlatform.TELEGRAM,
          });
          return;
        }
      }

      // Tratar ações conforme resultado da validação
      switch (validation.action) {
        case ValidationAction.ONBOARDING:
          this.logger.log(`[Telegram] 📝 User ${userId} is in onboarding`);
          await this.handleOnboardingMessage(sessionId, message);
          return;

        case ValidationAction.START_ONBOARDING:
          this.logger.log(`[Telegram] ⭐ Starting onboarding for new user ${userId}`);
          await this.startOnboarding(sessionId, message);
          return;

        case ValidationAction.BLOCKED:
          this.logger.warn(`[Telegram] ❌ User ${userId} is BLOCKED`);
          await this.platformReply.sendReply({
            platformId: userId,
            message: validation.message!,
            context: 'ERROR',
            platform: MessagingPlatform.TELEGRAM,
          });
          return;

        case ValidationAction.INACTIVE:
          this.logger.log(`[Telegram] 🔄 Reactivating user ${userId}`);
          await this.onboardingService.reactivateUser(userId, 'telegram');
          return;

        case ValidationAction.NO_SUBSCRIPTION:
          this.logger.warn(`[Telegram] 💳 User ${userId} has no subscription`);
          await this.platformReply.sendReply({
            platformId: userId,
            message: validation.message!,
            context: 'ERROR',
            platform: MessagingPlatform.TELEGRAM,
          });
          return;

        case ValidationAction.LEARNING_PENDING:
          this.logger.log(`[Telegram] 🎓 Processing learning for ${userId}`);
          const learningResult = await this.messageValidation.processLearning(
            userId,
            message.text || '',
            message.id,
            validation.user!,
            'telegram',
          );

          if (learningResult.success) {
            await this.platformReply.sendReply({
              platformId: userId,
              message: learningResult.message,
              context: 'INTENT_RESPONSE',
              platform: MessagingPlatform.TELEGRAM,
            });
          }
          return;

        case ValidationAction.PROCEED:
          this.logger.log(`[Telegram] ✅ Processing message for user ${validation.user!.name}`);
          break;

        default:
          this.logger.warn(`[Telegram] Unknown validation action: ${validation.action}`);
          return;
      }

      // Continuar com fluxo normal de transações
      const user = validation.user!;
      await this.processRegisteredUserMessage(sessionId, message, user);
    } catch (error) {
      this.logger.error(`Error processing Telegram message:`, error);
      await this.sendErrorMessage(sessionId, message.chatId);
    }
  }

  /**
   * Inicia onboarding para novo usuário
   * USA EVENTOS GENÉRICOS (padrão unificado)
   */
  private async startOnboarding(sessionId: string, message: IncomingMessage): Promise<void> {
    this.logger.log('🚀 [TelegramMessageHandler] Starting onboarding for new user');
    const userId = message.chatId;

    // Iniciar sessão de onboarding com platform 'telegram'
    const response = await this.onboardingService.startOnboarding(userId, 'telegram');

    // 🔧 CRÍTICO: Verificar se usuário já completou onboarding
    if (response.completed) {
      this.logger.warn(
        `⚠️ User ${userId} already completed onboarding - sending completion message`,
      );
      await this.platformReply.sendReply({
        platformId: userId,
        message: response.message || '✅ Seu cadastro já foi concluído anteriormente.',
        context: 'INTENT_RESPONSE',
        platform: MessagingPlatform.TELEGRAM,
      });
      return;
    }

    // Enviar mensagem de boas-vindas via evento
    await this.platformReply.sendReply({
      platformId: userId,
      message:
        `🎉 *Bem-vindo ao GastoCerto!*\n\n` +
        `Vou te ajudar a controlar suas finanças de forma simples e rápida.\n\n` +
        `Para começar, preciso de algumas informações:\n\n` +
        `📝 *Qual é o seu nome completo?*`,
      context: 'INTENT_RESPONSE',
      platform: MessagingPlatform.TELEGRAM,
    });

    this.logger.log(`Onboarding started for user ${userId}`);
  }

  /**
   * Processa mensagem durante onboarding
   * AGORA USA EVENTOS GENÉRICOS (mesmo padrão do WhatsApp)
   */
  private async handleOnboardingMessage(
    sessionId: string,
    message: IncomingMessage,
  ): Promise<void> {
    this.logger.log('📝 [HANDLE ONBOARDING] Processing onboarding message');
    const userId = message.chatId;
    this.logger.log(
      `📝 [HANDLE ONBOARDING] userId: ${userId}, messageType: ${message.type}, text: ${message.text?.substring(0, 50)}`,
    );

    // Aceitar mensagens de texto ou contact (para compartilhamento de telefone)
    if (message.type !== MessageType.TEXT || !message.text) {
      this.logger.log(`📝 [HANDLE ONBOARDING] Invalid message type, sending error`);
      await this.platformReply.sendReply({
        platformId: userId,
        message: '❌ Por favor, envie uma mensagem de texto.',
        context: 'ERROR',
        platform: MessagingPlatform.TELEGRAM,
      });
      return;
    }

    this.logger.log(`📝 [HANDLE ONBOARDING] Converting to IFilteredMessage...`);
    // Converter IncomingMessage para IFilteredMessage
    const filteredMessage: IFilteredMessage = {
      platformId: userId,
      messageId: message.id,
      phoneNumber: userId, // Compatível com fluxos que usam phoneNumber
      text: message.text,
      type: MessageType.TEXT,
      isFromMe: false,
      timestamp: Date.now(),
      platform: 'telegram',
    };

    this.logger.log(`📝 [HANDLE ONBOARDING] Calling onboardingService.handleMessage...`);
    // Usar handleMessage que emite eventos automaticamente
    await this.onboardingService.handleMessage(filteredMessage);
    this.logger.log(`📝 [HANDLE ONBOARDING] ✅ onboardingService.handleMessage completed`);
  }

  /**
   * Processa mensagem de usuário já cadastrado
   */
  private async processRegisteredUserMessage(
    sessionId: string,
    message: IncomingMessage,
    user: UserCache,
  ): Promise<void> {
    this.logger.log('💰 Processing transaction message from registered user');
    const userId = message.chatId;
    const accountId = user.activeAccountId; // Usar accountId do cache do usuário

    switch (message.type) {
      case MessageType.TEXT:
        if (message.text) {
          await this.transactionsService.processTextMessage(
            user, // Passar objeto user completo
            message.text,
            message.id,
            'telegram',
            userId, // Passar chatId como platformId para respostas corretas
            accountId, // Passar accountId do cache
          );
        }
        break;

      case MessageType.IMAGE:
        if (message.mediaBuffer) {
          await this.transactionsService.processImageMessage(
            user, // Passar objeto user completo
            message.mediaBuffer,
            message.mimeType || 'image/jpeg',
            message.id,
            'telegram',
            userId, // Passar chatId como platformId para respostas corretas
            accountId, // Passar accountId do cache
          );
        }
        break;

      case MessageType.AUDIO:
        if (message.mediaBuffer) {
          await this.transactionsService.processAudioMessage(
            user, // Passar objeto user completo
            message.mediaBuffer,
            message.mimeType || 'audio/ogg',
            message.id,
            'telegram',
            userId, // Passar chatId como platformId para respostas corretas
            accountId, // Passar accountId do cache
          );
        }
        break;

      default:
        await this.platformReply.sendReply({
          platformId: userId,
          message:
            '❌ Tipo de mensagem não suportado.\n\n' +
            'Envie:\n' +
            '• Texto: "Gastei 50 reais em alimentação"\n' +
            '• Foto de nota fiscal\n' +
            '• Áudio descrevendo o gasto',
          context: 'ERROR',
          platform: MessagingPlatform.TELEGRAM,
        });
    }
  }

  /**
   * Envia mensagem de erro via evento
   */
  private async sendErrorMessage(sessionId: string, chatId: string): Promise<void> {
    try {
      await this.platformReply.sendReply({
        platformId: chatId,
        message:
          '❌ Desculpe, ocorreu um erro ao processar sua mensagem.\n\n' +
          'Por favor, tente novamente em alguns instantes.',
        context: 'ERROR',
        platform: MessagingPlatform.TELEGRAM,
      });
    } catch (error) {
      this.logger.error(`Failed to emit error message event:`, error);
    }
  }
}
