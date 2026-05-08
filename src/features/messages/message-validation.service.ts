import { Injectable, Logger } from '@nestjs/common';
import { UserCacheService } from '@features/users/user-cache.service';
import { OnboardingService } from '@features/onboarding/onboarding.service';
import { MessageLearningService } from '@features/transactions/message-learning.service';
import { GastoCertoApiService } from '@shared/gasto-certo-api.service';
import { PlatformReplyService } from '@infrastructure/messaging/messages/platform-reply.service';
import { MessagingPlatform } from '@infrastructure/messaging/messaging-provider.interface';
import { UserCache } from '@prisma/client';

/**
 * Tipos de ação a serem tomadas após validação do usuário
 */
export enum ValidationAction {
  /** Usuário está em onboarding - processar mensagem de onboarding */
  ONBOARDING = 'onboarding',
  /** Novo usuário - iniciar onboarding */
  START_ONBOARDING = 'start_onboarding',
  /** Usuário bloqueado - rejeitar mensagem */
  BLOCKED = 'blocked',
  /** Usuário inativo - iniciar reativação */
  INACTIVE = 'inactive',
  /** Sem assinatura ativa - solicitar renovação */
  NO_SUBSCRIPTION = 'no_subscription',
  /** Usuário válido - prosseguir com processamento */
  PROCEED = 'proceed',
  /** Usuário tem aprendizado pendente */
  LEARNING_PENDING = 'learning_pending',
}

/**
 * Resultado da validação de usuário
 */
export interface ValidationResult {
  /** Se o usuário pode prosseguir com o fluxo normal */
  isValid: boolean;
  /** Ação recomendada após validação */
  action: ValidationAction;
  /** Dados do usuário (se encontrado) */
  user?: UserCache;
  /** Mensagem a ser enviada ao usuário (em caso de erro/bloqueio) */
  message?: string;
  /** Informações de aprendizado pendente */
  learningData?: {
    hasPending: boolean;
    context?: any;
  };
}

/**
 * MessageValidationService
 *
 * Serviço centralizado para validação de usuários e mensagens em todas as plataformas.
 * Consolida a lógica compartilhada entre WhatsApp, Telegram e Web Chat.
 *
 * Responsabilidades:
 * - Verificar status de onboarding
 * - Validar usuário (bloqueado, inativo, sem assinatura)
 * - Verificar aprendizado pendente
 * - Retornar ação apropriada e mensagens padronizadas
 */
@Injectable()
export class MessageValidationService {
  private readonly logger = new Logger(MessageValidationService.name);

  constructor(
    private readonly userCacheService: UserCacheService,
    private readonly onboardingService: OnboardingService,
    private readonly messageLearningService: MessageLearningService,
    private readonly gastoCertoApi: GastoCertoApiService,
    private readonly platformReply: PlatformReplyService,
  ) {}

  /**
   * Valida usuário e retorna ação apropriada
   *
   * @param platformId - ID do usuário na plataforma (phoneNumber, chatId, userId)
   * @param platform - Plataforma de origem ('whatsapp' | 'telegram' | 'web')
   * @returns ValidationResult com ação recomendada
   */
  async validateUser(
    platformId: string,
    platform: 'whatsapp' | 'telegram' | 'webchat',
  ): Promise<ValidationResult> {
    try {
      this.logger.debug(`🔍 [${platform}] Validating user: ${platformId}`);

      // 1. PRIMEIRO: Buscar usuário no cache
      const user = await this.fetchUser(platformId, platform);

      // 2. Se usuário existe e está OK, limpar sessões órfãs e prosseguir
      if (user && user.isActive && !user.isBlocked) {
        // Verificar se tem sessão de onboarding ativa (sessão órfã)
        const hasOrphanSession = await this.onboardingService.isUserOnboarding(platformId);

        if (hasOrphanSession) {
          this.logger.warn(
            `⚠️ [${platform}] User ${platformId} has active session but is already registered - cleaning up`,
          );
          // Limpar sessão órfã
          await this.cleanupOrphanSession(platformId);
        }

        this.logger.log(`✅ [${platform}] User ${user.name} validated successfully`);
        return {
          isValid: true,
          action: ValidationAction.PROCEED,
          user,
        };
      }

      // 3. DEPOIS: Verificar se está em processo de onboarding
      const isOnboarding = await this.onboardingService.isUserOnboarding(platformId);

      if (isOnboarding) {
        this.logger.log(`📝 [${platform}] User ${platformId} is in onboarding`);
        return {
          isValid: false,
          action: ValidationAction.ONBOARDING,
        };
      }

      // 4. Se usuário não existe, iniciar onboarding (exceto webchat)
      if (!user) {
        this.logger.log(`⭐ [${platform}] New user detected: ${platformId}`);

        // WebChat não tem onboarding — usuário já está autenticado via JWT
        if (platform === 'webchat') {
          return {
            isValid: false,
            action: ValidationAction.BLOCKED,
            message:
              '❌ *Acesso não autorizado*\n\n' +
              'Você precisa estar cadastrado para usar o GastoCerto.\n\n' +
              '📱 Use nosso app no WhatsApp ou Telegram para se cadastrar.',
          };
        }

        return {
          isValid: false,
          action: ValidationAction.START_ONBOARDING,
        };
      }

      this.logger.debug(
        `✅ [${platform}] User found: ${user.name} (gastoCertoId: ${user.gastoCertoId})`,
      );

      // 4. ❗ CRÍTICO: Verificar se usuário está bloqueado (PRIORIDADE MÁXIMA)
      if (user.isBlocked) {
        this.logger.warn(`❌ [${platform}] User ${platformId} is BLOCKED`);
        return {
          isValid: false,
          action: ValidationAction.BLOCKED,
          user,
          message:
            '🚫 *Acesso Bloqueado*\n\n' +
            'Sua conta foi bloqueada temporariamente.\n\n' +
            '📞 Entre em contato com o suporte para mais informações:\n' +
            'suporte@gastocerto.com',
        };
      }

      // 5. Verificar se usuário está inativo → Iniciar reativação
      if (!user.isActive) {
        this.logger.log(`🔄 [${platform}] User ${platformId} is INACTIVE`);
        return {
          isValid: false,
          action: ValidationAction.INACTIVE,
          user,
        };
      }

      // 6. Verificar assinatura ativa e permissão de uso (canUseGastoZap)
      if (!user.hasActiveSubscription || !user.canUseGastoZap) {
        this.logger.warn(
          `💳 [${platform}] User ${platformId} cannot use service | ` +
            `hasActiveSubscription=${user.hasActiveSubscription} | ` +
            `canUseGastoZap=${user.canUseGastoZap}`,
        );

        // Buscar mensagem personalizada da API
        let message =
          '💳 *Assinatura Inativa*\n\n' +
          'Sua assinatura expirou ou está inativa.\n\n' +
          '🔄 Para continuar usando o GastoZap, renove sua assinatura:\n' +
          '👉 https://gastocerto.com/assinatura\n\n' +
          '❓ Dúvidas? Fale conosco: suporte@gastocerto.com';

        // Tentar obter mensagem personalizada da API (sem bloquear)
        try {
          const status = await this.gastoCertoApi.getSubscriptionStatus(user.gastoCertoId);
          if (status.message) {
            message = status.message;
            if (status.purchaseUrl) {
              message += `\n\n👉 ${status.purchaseUrl}`;
            }
          }
        } catch (error) {
          this.logger.warn(`⚠️ Não foi possível obter mensagem da API: ${error.message}`);
        }

        return {
          isValid: false,
          action: ValidationAction.NO_SUBSCRIPTION,
          user,
          message,
        };
      }

      // 7. Verificar se tem aprendizado pendente
      const phoneNumber = user.phoneNumber;
      this.logger.log(`🔍 [${platform}] Checking pending learning for phoneNumber: ${phoneNumber}`);
      const learningCheck = await this.messageLearningService.hasPendingLearning(phoneNumber);

      if (learningCheck.hasPending) {
        this.logger.log(`🎓 [${platform}] User ${phoneNumber} has pending learning`);
        return {
          isValid: false,
          action: ValidationAction.LEARNING_PENDING,
          user,
          learningData: {
            hasPending: true,
            context: learningCheck.context,
          },
        };
      } else {
        this.logger.log(`✅ [${platform}] No pending learning for ${phoneNumber}`);
      }

      // 8. Usuário válido - pode prosseguir
      this.logger.log(`✅ [${platform}] User ${user.name} validated successfully`);
      return {
        isValid: true,
        action: ValidationAction.PROCEED,
        user,
      };
    } catch (error) {
      this.logger.error(`Error validating user ${platformId} on ${platform}:`, error);
      throw error;
    }
  }

  /**
   * Processa aprendizado pendente
   *
   * @param platformId - ID do usuário na plataforma
   * @param messageText - Texto da mensagem enviada pelo usuário
   * @param messageId - ID da mensagem
   * @param user - Dados do usuário
   * @param platform - Plataforma de origem
   * @returns Resultado do processamento
   */
  async processLearning(
    platformId: string,
    messageText: string,
    messageId: string,
    user: UserCache,
    platform: 'whatsapp' | 'telegram' | 'webchat',
  ): Promise<{
    success: boolean;
    message: string;
    shouldProcessTransaction: boolean;
    originalText?: string;
  }> {
    try {
      const phoneNumber = user.phoneNumber;

      this.logger.log(`🎓 [${platform}] Processing learning for ${phoneNumber}`);

      const result = await this.messageLearningService.processLearningMessage(
        phoneNumber,
        messageText,
        user.activeAccountId, // Passar activeAccountId do usuário
      );

      if (!result.success) {
        this.logger.warn(`⚠️ [${platform}] Learning failed: ${result.message}`);
        return {
          success: false,
          message: result.message,
          shouldProcessTransaction: false,
        };
      }

      // Se deve processar transação original
      if (result.shouldProcessOriginalTransaction && result.originalText) {
        this.logger.log(
          `🔄 [${platform}] Processing original transaction: "${result.originalText.substring(0, 50)}..."`,
        );

        const transactionResult = await this.messageLearningService.processOriginalTransaction(
          phoneNumber,
          result.originalText,
          messageId,
          user,
          platform,
          undefined, // accountId
          result.overrideCategory, // Categoria escolhida no learning flow
        );

        if (transactionResult) {
          return {
            success: true,
            message: `${result.message}\n\n${transactionResult.message}`,
            shouldProcessTransaction: false, // Já processou
          };
        }
      }

      return {
        success: true,
        message: result.message,
        shouldProcessTransaction: false,
      };
    } catch (error) {
      this.logger.error(`Error processing learning for ${platformId}:`, error);
      return {
        success: false,
        message: '❌ Erro ao processar resposta. Tente novamente.',
        shouldProcessTransaction: false,
      };
    }
  }

  /**
   * Inicia onboarding para novo usuário
   *
   * @param platformId - ID do usuário na plataforma
   * @param platform - Plataforma de origem
   * @returns Mensagem de boas-vindas ou null se já completou
   */
  async startOnboarding(
    platformId: string,
    platform: 'whatsapp' | 'telegram' | 'webchat',
  ): Promise<string | null> {
    try {
      this.logger.log(`🚀 [${platform}] Starting onboarding for ${platformId}`);

      const response = await this.onboardingService.startOnboarding(
        platformId,
        platform as 'whatsapp' | 'telegram', // webchat nunca chega aqui (retorna BLOCKED)
      );

      // Se usuário já completou onboarding
      if (response.completed) {
        this.logger.warn(`⚠️ [${platform}] User ${platformId} already completed onboarding`);
        return response.message || '✅ Seu cadastro já foi concluído anteriormente.';
      }

      // Retornar mensagem de boas-vindas padrão
      return (
        `🎉 *Bem-vindo ao GastoCerto!*\n\n` +
        `Vou te ajudar a controlar suas finanças de forma simples e rápida.\n\n` +
        `Para começar, preciso de algumas informações:\n\n` +
        `📝 *Qual é o seu nome completo?*`
      );
    } catch (error) {
      this.logger.error(`Error starting onboarding for ${platformId}:`, error);
      throw error;
    }
  }

  /**
   * Envia mensagem ao usuário (helper genérico)
   *
   * @param platformId - ID do usuário na plataforma
   * @param message - Mensagem a ser enviada
   * @param platform - Plataforma de origem
   * @param context - Contexto da mensagem (ERROR, INTENT_RESPONSE, etc.)
   */
  sendMessage(
    platformId: string,
    message: string,
    platform: MessagingPlatform,
    context: string = 'ERROR',
  ): void {
    // Delegar para PlatformReplyService (centralizado)
    void this.platformReply.sendReply({
      platformId,
      message,
      context,
      platform,
    });
  }

  /**
   * Busca usuário de acordo com a plataforma
   * - WhatsApp: usa phoneNumber diretamente
   * - Telegram: usa chatId/telegramId
   * - WebChat: usa gastoCertoId (já autenticado via JWT)
   */
  private async fetchUser(
    platformId: string,
    platform: 'whatsapp' | 'telegram' | 'webchat',
  ): Promise<UserCache | null> {
    try {
      switch (platform) {
        case 'whatsapp':
          return await this.userCacheService.getUser(platformId);

        case 'telegram':
          return await this.userCacheService.getUserByTelegram(platformId);

        case 'webchat':
          return await this.userCacheService.getUserByGastoCertoId(platformId);

        default:
          this.logger.warn(`Unknown platform: ${platform}`);
          return null;
      }
    } catch (error) {
      this.logger.error(`Error fetching user ${platformId} from ${platform}:`, error);
      return null;
    }
  }

  /**
   * Limpa sessões de onboarding órfãs para usuários já registrados
   */
  private async cleanupOrphanSession(platformId: string): Promise<void> {
    try {
      await this.onboardingService['onboardingState']['prisma'].onboardingSession.updateMany({
        where: {
          platformId,
          completed: false,
        },
        data: {
          completed: true,
          updatedAt: new Date(),
        },
      });
      this.logger.log(`✅ Orphan session cleaned up for ${platformId}`);
    } catch (error) {
      this.logger.error(`Error cleaning up orphan session for ${platformId}:`, error);
    }
  }
}
