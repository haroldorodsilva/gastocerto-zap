import { Injectable, Logger } from '@nestjs/common';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import {
  MessagingPlatform,
  IncomingMessage,
  MessageType,
} from '@infrastructure/messaging/messaging-provider.interface';
import { OnboardingService } from '@features/onboarding/onboarding.service';
import { TransactionsService } from '@features/transactions/transactions.service';
import { MultiPlatformSessionService } from '@infrastructure/messaging/core/services/multi-platform-session.service';
import { MessageContextService } from '../message-context.service';
import { IFilteredMessage } from '@infrastructure/messaging/message.interface';
import { UserCacheService } from '@features/users/user-cache.service';
import { UserRateLimiterService } from '@common/services/user-rate-limiter.service';
import { UserCache } from '@prisma/client';
import {
  MessageValidationService,
  ValidationAction,
} from '@features/messages/message-validation.service';

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
    private readonly eventEmitter: EventEmitter2,
    private readonly userCacheService: UserCacheService,
    private readonly userRateLimiter: UserRateLimiterService,
    private readonly messageValidation: MessageValidationService,
  ) {}

  @OnEvent('telegram.message')
  async handleMessage(event: MessageReceivedEvent): Promise<void> {
    this.logger.log('🔔 Event telegram.message captured!');
    this.logger.log(`📱 Platform: ${event.platform}`);

    // Processar apenas mensagens do Telegram
    if (event.platform !== MessagingPlatform.TELEGRAM) {
      this.logger.log(`⏭️  Ignoring non-Telegram message (platform: ${event.platform})`);
      return;
    }

    const { sessionId, message } = event;

    this.logger.log(
      `Processing Telegram message from ${message.userId} (chat: ${message.chatId}), type: ${message.type}`,
    );

    try {
      // Usar chatId como identificador do usuário (equivalente ao phoneNumber no WhatsApp)
      const userId = message.chatId;

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
        this.eventEmitter.emit('telegram.reply', {
          platformId: userId,
          message: limitMessage,
          context: 'ERROR',
          platform: MessagingPlatform.TELEGRAM,
        });
        return; // ❌ Bloqueia processamento
      }

      // ✅ Registrar uso da mensagem
      await this.userRateLimiter.recordUsage(userId);

      // Buscar usuário cadastrado para obter gastoCertoId e phoneNumber
      let gastoCertoId: string | undefined;
      let phoneNumber: string | undefined;

      try {
        // Buscar usuário pelo telegramId via método público do UserCacheService
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

      // ✨ NOVO: Registrar contexto da plataforma para roteamento de respostas
      this.contextService.registerContext(
        userId,
        sessionId,
        MessagingPlatform.TELEGRAM,
        gastoCertoId,
        phoneNumber,
      );
      this.logger.debug(
        `📝 Contexto registrado: Telegram [${userId}] → ${sessionId}` +
          (gastoCertoId ? ` | userId: ${gastoCertoId}` : ''),
      );

      // ✨ NOVO: Usar MessageValidationService para validação unificada
      const validation = await this.messageValidation.validateUser(userId, 'telegram');

      // 🔄 SINCRONIZAÇÃO: Verificar se precisa sincronizar status (1h) — mesmo padrão do WhatsApp
      if (validation.user && this.userCacheService.needsSync(validation.user)) {
        this.logger.log(`⏰ [Telegram] Syncing subscription status for ${userId}`);
        await this.userCacheService.syncSubscriptionStatus(validation.user.gastoCertoId);

        // Revalidar usuário com dados atualizados
        const updatedValidation = await this.messageValidation.validateUser(userId, 'telegram');

        if (updatedValidation.action === ValidationAction.NO_SUBSCRIPTION) {
          this.logger.warn(`[Telegram] 💳 User ${userId} subscription expired after sync`);
          this.eventEmitter.emit('telegram.reply', {
            platformId: userId,
            message: updatedValidation.message!,
            context: 'ERROR',
            platform: MessagingPlatform.TELEGRAM,
          });
          return;
        }
      }

      // Tratar ações conforme resultado da validação
      switch (validation.action) {
        case ValidationAction.ONBOARDING:
          // Usuário está em onboarding - processar mensagem
          this.logger.log(`[Telegram] 📝 User ${userId} is in onboarding`);
          await this.handleOnboardingMessage(sessionId, message);
          return;

        case ValidationAction.START_ONBOARDING:
          // Novo usuário - iniciar onboarding
          this.logger.log(`[Telegram] ⭐ Starting onboarding for new user ${userId}`);
          await this.startOnboarding(sessionId, message);
          return;

        case ValidationAction.BLOCKED:
          // Usuário bloqueado
          this.logger.warn(`[Telegram] ❌ User ${userId} is BLOCKED`);
          this.eventEmitter.emit('telegram.reply', {
            platformId: userId,
            message: validation.message!,
            context: 'ERROR',
            platform: MessagingPlatform.TELEGRAM,
          });
          return;

        case ValidationAction.INACTIVE:
          // Usuário inativo - reativar
          this.logger.log(`[Telegram] 🔄 Reactivating user ${userId}`);
          await this.onboardingService.reactivateUser(userId, 'telegram');
          return;

        case ValidationAction.NO_SUBSCRIPTION:
          // Sem assinatura ativa
          this.logger.warn(`[Telegram] 💳 User ${userId} has no subscription`);
          this.eventEmitter.emit('telegram.reply', {
            platformId: userId,
            message: validation.message!,
            context: 'ERROR',
            platform: MessagingPlatform.TELEGRAM,
          });
          return;

        case ValidationAction.LEARNING_PENDING:
          // Aprendizado pendente
          this.logger.log(`[Telegram] 🎓 Processing learning for ${userId}`);
          const learningResult = await this.messageValidation.processLearning(
            userId,
            message.text || '',
            message.id,
            validation.user!,
            'telegram',
          );

          if (learningResult.success) {
            this.eventEmitter.emit('telegram.reply', {
              platformId: userId,
              message: learningResult.message,
              context: 'INTENT_RESPONSE',
              platform: MessagingPlatform.TELEGRAM,
            });
          }
          return;

        case ValidationAction.PROCEED:
          // Usuário válido - prosseguir com processamento normal
          this.logger.log(`[Telegram] ✅ Processing message for user ${validation.user!.name}`);
          break;

        default:
          this.logger.warn(`[Telegram] Unknown validation action: ${validation.action}`);
          return;
      }

      // Continuar com fluxo normal de transações
      const user = validation.user!;
      this.logger.log(`[Telegram] Processing message from registered user ${user.name}`);
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
      this.eventEmitter.emit('telegram.reply', {
        platformId: userId,
        message: response.message || '✅ Seu cadastro já foi concluído anteriormente.',
        context: 'INTENT_RESPONSE',
        platform: MessagingPlatform.TELEGRAM,
      });
      return;
    }

    // Enviar mensagem de boas-vindas via evento
    this.eventEmitter.emit('telegram.reply', {
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
      this.eventEmitter.emit('telegram.reply', {
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
      messageId: message.id,
      phoneNumber: userId, // Usar chatId como phoneNumber (identificador da plataforma)
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
        this.eventEmitter.emit('telegram.reply', {
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
      this.eventEmitter.emit('telegram.reply', {
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
