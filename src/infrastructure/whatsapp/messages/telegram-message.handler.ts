import { Injectable, Logger } from '@nestjs/common';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import {
  MessagingPlatform,
  IncomingMessage,
  MessageType,
} from '@common/interfaces/messaging-provider.interface';
import { OnboardingService } from '@features/onboarding/onboarding.service';
import { TransactionsService } from '@features/transactions/transactions.service';
import { MultiPlatformSessionService } from '../sessions/multi-platform-session.service';
import { MessageContextService } from './message-context.service';
import { IFilteredMessage } from '@common/interfaces/message.interface';
import { UserCacheService } from '@features/users/user-cache.service';

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

      // Buscar usuário cadastrado para obter gastoCertoId e phoneNumber
      let gastoCertoId: string | undefined;
      let phoneNumber: string | undefined;

      try {
        // Buscar usuário pelo telegramId no banco
        const userCache = await this.userCacheService['prisma'].userCache.findFirst({
          where: { telegramId: userId },
        });

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

      // 1. Verificar se usuário está em onboarding
      const isOnboarding = await this.onboardingService.isUserOnboarding(userId);

      if (isOnboarding) {
        this.logger.log(`User ${userId} is in onboarding`);
        await this.handleOnboardingMessage(sessionId, message);
        return;
      }

      // 2. Buscar dados completos do usuário (com isBlocked e isActive)
      const user = await this.userCacheService.getUser(userId);

      if (!user) {
        // Usuário não encontrado - pode ser novo, encaminhar para onboarding
        this.logger.log(`[Telegram] New user detected: ${userId}, starting onboarding`);
        await this.startOnboarding(sessionId, message);
        return;
      }

      // 3. Verificar se usuário está bloqueado
      if (user.isBlocked) {
        this.logger.warn(`[Telegram] User ${userId} is blocked`);
        this.eventEmitter.emit('telegram.reply', {
          platformId: userId,
          message:
            '🚫 *Acesso Bloqueado*\n\n' +
            'Sua conta foi bloqueada temporariamente.\n\n' +
            '📞 Entre em contato com o suporte para mais informações:\n' +
            'suporte@gastocerto.com',
          context: 'ERROR',
          platform: MessagingPlatform.TELEGRAM,
        });
        return;
      }

      // 4. Verificar se usuário está ativo
      if (!user.isActive) {
        this.logger.warn(`[Telegram] User ${userId} is inactive`);
        this.eventEmitter.emit('telegram.reply', {
          platformId: userId,
          message:
            '⚠️ *Conta Desativada*\n\n' +
            'Sua conta está temporariamente desativada.\n\n' +
            '✅ Para reativar, entre em contato com o suporte:\n' +
            'suporte@gastocerto.com',
          context: 'ERROR',
          platform: MessagingPlatform.TELEGRAM,
        });
        return;
      }

      // 5. Verificar assinatura ativa
      if (!user.hasActiveSubscription) {
        this.logger.warn(`[Telegram] User ${userId} has no active subscription`);
        this.eventEmitter.emit('telegram.reply', {
          platformId: userId,
          message:
            '💳 *Assinatura Inativa*\n\n' +
            'Sua assinatura expirou ou está inativa.\n\n' +
            '🔄 Para continuar usando o GastoCerto, renove sua assinatura:\n' +
            '👉 https://gastocerto.com/assinatura\n\n' +
            '❓ Dúvidas? Fale conosco: suporte@gastocerto.com',
          context: 'ERROR',
          platform: MessagingPlatform.TELEGRAM,
        });
        return;
      }

      // 6. Usuário válido - processar mensagem normalmente
      this.logger.log(`[Telegram] Processing message from registered user ${user.name}`);
      await this.processRegisteredUserMessage(sessionId, message);
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
    await this.onboardingService.startOnboarding(userId, 'telegram');

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
    this.logger.log('📝 Processing onboarding message');
    const userId = message.chatId;

    // Aceitar mensagens de texto ou contact (para compartilhamento de telefone)
    if (message.type !== MessageType.TEXT || !message.text) {
      this.eventEmitter.emit('telegram.reply', {
        platformId: userId,
        message: '❌ Por favor, envie uma mensagem de texto.',
        context: 'ERROR',
        platform: MessagingPlatform.TELEGRAM,
      });
      return;
    }

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

    // Usar handleMessage que emite eventos automaticamente
    await this.onboardingService.handleMessage(filteredMessage);
  }

  /**
   * Processa mensagem de usuário já cadastrado
   */
  private async processRegisteredUserMessage(
    sessionId: string,
    message: IncomingMessage,
  ): Promise<void> {
    this.logger.log('💰 Processing transaction message from registered user');
    const userId = message.chatId;

    switch (message.type) {
      case MessageType.TEXT:
        if (message.text) {
          await this.transactionsService.processTextMessage(
            userId,
            message.text,
            message.id,
            'telegram',
          );
        }
        break;

      case MessageType.IMAGE:
        if (message.mediaBuffer) {
          await this.transactionsService.processImageMessage(
            userId,
            message.mediaBuffer,
            message.mimeType || 'image/jpeg',
            message.id,
            'telegram',
          );
        }
        break;

      case MessageType.AUDIO:
        if (message.mediaBuffer) {
          await this.transactionsService.processAudioMessage(
            userId,
            message.mediaBuffer,
            message.mimeType || 'audio/ogg',
            message.id,
            'telegram',
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
