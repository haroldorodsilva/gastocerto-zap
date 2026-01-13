import { Injectable, Logger, Optional, Inject, forwardRef } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { OnboardingStateService } from './onboarding-state.service';
import { GastoCertoApiService } from '@shared/gasto-certo-api.service';
import { UserCacheService } from '@features/users/user-cache.service';
import { RAGService } from '@infrastructure/rag/services/rag.service';
import { PrismaService } from '@core/database/prisma.service';
import { OnboardingResponse } from './dto/onboarding.dto';
import { CreateUserDto } from '../users/dto/user.dto';
import { IFilteredMessage } from '@infrastructure/messaging/message.interface';
import { MessageContextService } from '@infrastructure/messaging/messages/message-context.service';
import { MessagingPlatform } from '@infrastructure/messaging/messaging-provider.interface';

@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private readonly onboardingState: OnboardingStateService,
    private readonly gastoCertoApi: GastoCertoApiService,
    private readonly userCache: UserCacheService,
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(forwardRef(() => MessageContextService))
    private readonly contextService: MessageContextService,
    @Optional() private readonly ragService?: RAGService,
  ) {}

  /**
   * Processa mensagem durante o fluxo de onboarding
   * Novo método que aceita IFilteredMessage
   */
  async handleMessage(message: IFilteredMessage): Promise<void> {
    const { phoneNumber, text } = message;

    this.logger.log(
      `📥 [HANDLE MESSAGE] Received message:\n` +
        `  - phoneNumber: ${phoneNumber}\n` +
        `  - text: ${text?.substring(0, 50)}\n` +
        `  - platform: ${message.platform}`,
    );

    if (!text) {
      this.logger.warn(`⚠️ [HANDLE MESSAGE] Message from ${phoneNumber} has no text content`);
      return;
    }

    this.logger.log(`📤 [HANDLE MESSAGE] Calling processOnboardingMessage...`);
    const result = await this.processOnboardingMessage(phoneNumber, text);
    this.logger.log(
      `📤 [HANDLE MESSAGE] processOnboardingMessage result:\n` +
        `  - shouldSendMessage: ${result.shouldSendMessage}\n` +
        `  - currentStep: ${result.response.currentStep}\n` +
        `  - hasMessage: ${!!result.response.message}`,
    );

    if (result.shouldSendMessage && result.response.message) {
      // Detectar plataforma dinamicamente através do contexto
      const messageContext = this.contextService.getContext(phoneNumber);
      const platform = messageContext?.platform || MessagingPlatform.WHATSAPP;
      const eventName =
        platform === MessagingPlatform.TELEGRAM ? 'telegram.reply' : 'whatsapp.reply';

      this.logger.debug(`📤 Detectada plataforma ${platform} para ${phoneNumber}`);

      this.logger.log(`📤 [HANDLE MESSAGE] Emitting ${eventName} event...`);
      // Enviar mensagem via MessageResponseService (genérico)
      this.eventEmitter.emit(eventName, {
        platformId: phoneNumber,
        message: result.response.message,
        context: 'INTENT_RESPONSE',
        metadata: {
          step: result.response.currentStep,
        },
        platform,
      });

      this.logger.log(
        `📤 Onboarding reply emitted [${platform}] for ${phoneNumber}: ${result.response.message.substring(0, 50)}...`,
      );
    } else {
      this.logger.log(
        `📤 [HANDLE MESSAGE] NOT sending message (shouldSendMessage=${result.shouldSendMessage})`,
      );
    }
  }

  /**
   * Processa mensagem durante o fluxo de onboarding
   */
  async processOnboardingMessage(
    phoneNumber: string,
    message: string,
    metadata?: any,
  ): Promise<{ response: OnboardingResponse; shouldSendMessage: boolean }> {
    try {
      // Processar mensagem na máquina de estados (com metadata para contact sharing)
      const response = await this.onboardingState.processMessage(phoneNumber, message, metadata);

      this.logger.log(
        `📍 Step atual: ${response.currentStep}, hasEmail: ${!!response.data?.email}`,
      );

      // Se o step for CHECK_EXISTING_USER, verificar se usuário existe
      if (response.currentStep === 'CHECK_EXISTING_USER' && response.data?.email) {
        this.logger.log(`🔍 Verificando se email ${response.data.email} já existe...`);

        const checkResult = await this.checkExistingUser(phoneNumber, response.data);

        if (checkResult.exists) {
          // Usuário já existe - iniciar fluxo de verificação
          await this.onboardingState.updateSession(phoneNumber, {
            currentStep: 'REQUEST_VERIFICATION_CODE',
            data: response.data,
          });

          return {
            response: {
              completed: false,
              currentStep: 'REQUEST_VERIFICATION_CODE',
              message: checkResult.message,
              data: response.data,
            },
            shouldSendMessage: true,
          };
        } else {
          // Usuário novo - ir para confirmação de dados
          this.logger.log(`Email disponível - prosseguindo para confirmação de dados`);

          await this.onboardingState.updateSession(phoneNumber, {
            currentStep: 'CONFIRM_DATA',
            data: response.data,
          });

          const confirmationMessage = this.getConfirmationMessage(response.data);

          return {
            response: {
              completed: false,
              currentStep: 'CONFIRM_DATA',
              message: confirmationMessage,
              data: response.data,
            },
            shouldSendMessage: true,
          };
        }
      }

      // Se o step for REQUEST_VERIFICATION_CODE e tem flag de reenvio
      if (response.currentStep === 'REQUEST_VERIFICATION_CODE' && response.data?.resendCode) {
        this.logger.log(`🔄 Reenviando código de verificação para ${response.data.email}`);

        // Reenviar código
        await this.checkExistingUser(phoneNumber, response.data);

        // Limpar flag de reenvio
        const cleanData = { ...response.data };
        delete cleanData.resendCode;

        await this.onboardingState.updateSession(phoneNumber, {
          currentStep: 'REQUEST_VERIFICATION_CODE',
          data: cleanData,
        });

        return {
          response: {
            completed: false,
            currentStep: 'REQUEST_VERIFICATION_CODE',
            message:
              `✅ Código reenviado para *${response.data.email}*!\n\n` +
              `Por favor, verifique sua caixa de entrada e digite o código de 6 dígitos.\n\n` +
              `💡 Não recebeu?\n` +
              `• Verifique a pasta de spam\n` +
              `• Digite *"reenviar"* para tentar novamente\n` +
              `• Digite *"corrigir email"* se o email está errado`,
            data: cleanData,
          },
          shouldSendMessage: true,
        };
      }

      // Se o step for VERIFY_CODE, validar o código
      if (response.currentStep === 'VERIFY_CODE' && response.data?.verificationCode) {
        this.logger.log(`🔐 Validando código de verificação...`);

        const verifyResult = await this.verifyCode(phoneNumber, response.data);

        if (verifyResult.success) {
          // Código válido - completar onboarding
          await this.onboardingState.completeOnboarding(phoneNumber);

          return {
            response: {
              completed: true,
              currentStep: 'COMPLETED',
              message: verifyResult.message,
              data: response.data,
            },
            shouldSendMessage: true,
          };
        } else {
          // Código inválido - voltar para REQUEST_VERIFICATION_CODE
          await this.onboardingState.updateSession(phoneNumber, {
            currentStep: 'REQUEST_VERIFICATION_CODE',
            data: response.data,
          });

          return {
            response: {
              completed: false,
              currentStep: 'REQUEST_VERIFICATION_CODE',
              message: verifyResult.message,
              data: response.data,
            },
            shouldSendMessage: true,
          };
        }
      }

      // Se o step for CREATING_ACCOUNT, criar usuário na API
      if (response.currentStep === 'CREATING_ACCOUNT' && response.data) {
        const createUserResult = await this.createUserInApi(phoneNumber, response.data);

        if (createUserResult.success) {
          // Marcar onboarding como completo
          await this.onboardingState.completeOnboarding(phoneNumber);

          // ✅ NOVO: Reativar usuário se ele estava inativo
          await this.reactivateUserIfNeeded(phoneNumber);

          // Registrar em audit log
          await this.logOnboardingComplete(phoneNumber);

          return {
            response: {
              completed: true,
              currentStep: 'COMPLETED',
              message: createUserResult.message,
              data: response.data,
            },
            shouldSendMessage: true,
          };
        } else {
          // Erro ao criar usuário
          return {
            response: {
              completed: false,
              currentStep: response.currentStep,
              message: `❌ ${createUserResult.error}\n\nPor favor, tente novamente mais tarde ou entre em contato com o suporte.`,
              data: response.data,
            },
            shouldSendMessage: true,
          };
        }
      }

      return {
        response,
        shouldSendMessage: true,
      };
    } catch (error) {
      this.logger.error(`Erro ao processar onboarding para ${phoneNumber}:`, error);

      return {
        response: {
          completed: false,
          currentStep: 'COLLECT_NAME',
          message: '❌ Ocorreu um erro ao processar sua mensagem. Por favor, tente novamente.',
        },
        shouldSendMessage: true,
      };
    }
  }

  /**
   * Cria usuário na API Gasto Certo
   */
  private async createUserInApi(
    phoneNumber: string,
    data: any,
  ): Promise<{ success: boolean; message?: string; error?: string }> {
    try {
      this.logger.log(`Criando usuário na API: ${data.name} (${phoneNumber})`);

      // Usar telefone real (do contact sharing) ou deixar vazio
      // NUNCA usar chatId como phoneNumber
      const realPhone = data.realPhoneNumber || '';

      const createUserDto: CreateUserDto = {
        name: data.name,
        email: data.email,
        phoneNumber: realPhone,
        source: data.platform || 'telegram',
        acceptedTerms: true,
        metadata: {
          onboardingCompletedAt: new Date().toISOString(),
          telegramChatId: data.platform === 'telegram' ? phoneNumber : undefined,
        },
      };

      // Criar usuário na API
      const apiUser = await this.gastoCertoApi.createUser(createUserDto);

      this.logger.log(`🔍 DEBUG - API retornou phoneNumber: ${apiUser.phoneNumber}`);
      this.logger.log(`🔍 DEBUG - realPhoneNumber do onboarding: ${data.realPhoneNumber}`);
      this.logger.log(`🔍 DEBUG - phoneNumber parameter (platformId): ${phoneNumber}`);

      // Criar cache local com informação de plataforma
      // phoneNumber = ID da plataforma (Telegram ID ou WhatsApp ID)
      // data.realPhoneNumber = Telefone real coletado no onboarding
      const platform = data.platform || 'telegram';
      await this.userCache.createUserCacheWithPlatform(
        apiUser,
        platform,
        phoneNumber,
        data.realPhoneNumber,
      );
      this.logger.log(`✅ Usuário criado com sucesso: ${apiUser.id}`);

      // Indexar categorias no RAG após criar cache
      if (this.ragService) {
        try {
          const categoriesData = await this.userCache.getUserCategories(phoneNumber);
          if (categoriesData.categories.length > 0) {
            // Importar função helper
            const { expandCategoriesForRAG } = await import('../users/user-cache.service');
            const userCategories = expandCategoriesForRAG(categoriesData.categories);

            await this.ragService.indexUserCategories(apiUser.id, userCategories);
            this.logger.log(
              `🧠 RAG indexado no onboarding: ${userCategories.length} categorias | UserId: ${apiUser.id}`,
            );
          }
        } catch (ragError) {
          this.logger.warn(`⚠️ Erro ao indexar RAG no onboarding (não bloqueante):`, ragError);
        }
      }

      return {
        success: true,
        message:
          `🎉 *Pronto, ${data.name}!*\n\n` +
          `Seu cadastro está completo e você já pode usar o GastoCerto! 🚀\n\n` +
          `*Como funciona?*\n` +
          `É simples! Basta me enviar uma mensagem quando você gastar ou receber dinheiro:\n\n` +
          `💬 "Gastei R$ 50 no mercado"\n` +
          `📸 Envie foto de uma nota fiscal\n` +
          `🎤 Grave um áudio descrevendo\n\n` +
          `Vou organizar tudo pra você! Pode mandar a primeira transação agora mesmo. 😊`,
      };
    } catch (error: any) {
      this.logger.error('Erro ao criar usuário na API:', error);

      // Verificar se é erro de usuário duplicado
      if (error.status === 409) {
        // Usuário já existe, sincronizar cache
        try {
          await this.userCache.syncUser(phoneNumber);
          await this.onboardingState.completeOnboarding(phoneNumber);

          return {
            success: true,
            message:
              `🎉 *Bem-vindo de volta!*\n\n` +
              `Que bom te ver novamente! Seu cadastro já está ativo.\n\n` +
              `Pode continuar registrando suas transações normalmente. 😊`,
          };
        } catch (syncError) {
          this.logger.error('Erro ao sincronizar usuário existente:', syncError);
        }
      }

      return {
        success: false,
        error: 'Não foi possível completar seu cadastro',
      };
    }
  }

  /**
   * Verifica código de verificação
   */
  private async verifyCode(
    phoneNumber: string,
    data: any,
  ): Promise<{ success: boolean; message: string }> {
    try {
      this.logger.log(`Validando código ${data.verificationCode} para ${data.email}`);
      this.logger.log(`🔍 DEBUG ANTES DA VALIDAÇÃO - realPhoneNumber: ${data.realPhoneNumber}`);
      this.logger.log(`🔍 DEBUG ANTES DA VALIDAÇÃO - phoneNumber (API): ${data.phoneNumber}`);
      this.logger.log(`🔍 DEBUG ANTES DA VALIDAÇÃO - platformId: ${phoneNumber}`);
      this.logger.log(`🔍 DEBUG ANTES DA VALIDAÇÃO - data completo: ${JSON.stringify(data)}`);

      // ⚠️ CORREÇÃO: Para usuários existentes, usar telefone da API
      // Para novos usuários, usar realPhoneNumber coletado no onboarding
      let phoneToValidate = data.phoneNumber || data.realPhoneNumber;

      if (!phoneToValidate) {
        this.logger.error(`❌ ERRO: Nenhum telefone disponível para validação!`);
        this.logger.error(`data.phoneNumber (API): ${data.phoneNumber}`);
        this.logger.error(`data.realPhoneNumber (coletado): ${data.realPhoneNumber}`);

        return {
          success: false,
          message:
            '❌ *Erro no cadastro*\n\n' +
            'Não conseguimos encontrar seu telefone no sistema.\n\n' +
            'Por favor, digite *"recomeçar"* para iniciar novamente.',
        };
      }

      // Normalizar telefone: remover tudo exceto dígitos
      phoneToValidate = phoneToValidate.replace(/\D/g, '');

      // Garantir que tem pelo menos 10 dígitos (DDD + número)
      if (phoneToValidate.length < 10) {
        this.logger.error(`❌ ERRO: Telefone inválido após normalização: ${phoneToValidate}`);
        return {
          success: false,
          message:
            '❌ *Telefone inválido*\n\n' +
            'O telefone fornecido está incompleto.\n\n' +
            'Por favor, digite *"recomeçar"* para iniciar novamente.',
        };
      }

      this.logger.log(`✅ Telefone normalizado para validação: ${phoneToValidate}`);

      // Validar código na API
      const result = await this.gastoCertoApi.validateAuthCode({
        email: data.email,
        phoneNumber: phoneToValidate,
        code: data.verificationCode,
      });

      if (result.success && result.user) {
        this.logger.log(`🔍 DEBUG - API retornou phoneNumber: ${result.user.phoneNumber}`);
        this.logger.log(`🔍 DEBUG - phoneToValidate usado: ${phoneToValidate}`);
        this.logger.log(`🔍 DEBUG - phoneNumber parameter (platformId): ${phoneNumber}`);

        // Código válido - criar cache do usuário retornado com informação de plataforma
        // phoneNumber = ID da plataforma (Telegram ID ou WhatsApp ID)
        // phoneToValidate = Telefone real (da API ou coletado no onboarding)
        const platform = data.platform || 'telegram';
        await this.userCache.createUserCacheWithPlatform(
          result.user,
          platform,
          phoneNumber,
          data.realPhoneNumber,
        );
        this.logger.log(`✅ Código validado e cache criado para ${phoneNumber}`);

        return {
          success: true,
          message:
            `🎉 *Perfeito, ${data.name}!*\n\n` +
            `Código validado com sucesso! Seu telefone já está vinculado à sua conta.\n\n` +
            `Agora você pode registrar suas transações por aqui também. Vamos lá! 🚀\n\n` +
            `Digite uma mensagem como "Gastei R$ 20 no mercado" para começar ou digite ajuda para ver o que posso fazer por você.`,
        };
      } else {
        // Log detalhado do erro
        this.logger.error(`❌ Validação falhou - result.success: ${result.success}`);
        this.logger.error(`❌ result.message: ${result.message || 'Nenhuma mensagem'}`);
        this.logger.error(`❌ Código tentado: ${data.verificationCode}`);
        this.logger.error(`❌ Email: ${data.email}, Telefone: ${phoneToValidate}`);

        // Mensagem de erro mais detalhada
        const errorMessage = result.message || 'Código incorreto';

        return {
          success: false,
          message:
            `❌ *Falha na validação*\n\n` +
            `${errorMessage}\n\n` +
            `💡 *Você pode:*\n` +
            `• Digite o código de 6 dígitos novamente\n` +
            `• Digite *"reenviar"* para receber um novo código\n` +
            `• Digite *"corrigir email"* se o email está errado\n\n` +
            `⚠️ *Dados enviados:*\n` +
            `Email: ${data.email}\n` +
            `Telefone: ${phoneToValidate}`,
        };
      }
    } catch (error) {
      this.logger.error('Erro ao validar código:', error);
      return {
        success: false,
        message:
          `❌ Não foi possível validar o código.\n\n` +
          `💡 *Você pode:*\n` +
          `• Tente novamente digitando o código\n` +
          `• Digite *"reenviar"* para receber um novo código\n` +
          `• Digite *"corrigir email"* se o email está errado`,
      };
    }
  }

  /**
   * Registra conclusão do onboarding no audit log
   * REMOVIDO: auditLog foi deletado do schema
   */
  private async logOnboardingComplete(phoneNumber: string): Promise<void> {
    // Método mantido para compatibilidade mas não faz nada
    // auditLog foi removido do schema.prisma
    this.logger.debug(`Onboarding completo para ${phoneNumber}`);
  }

  /**
   * Verifica se usuário já existe na API
   */
  private async checkExistingUser(
    phoneNumber: string,
    data: any,
  ): Promise<{ exists: boolean; message?: string; userId?: string }> {
    try {
      this.logger.log(`Verificando se email ${data.email} já existe...`);

      const checkResult = await this.gastoCertoApi.getUserByEmail(data.email);

      if (checkResult.exists && checkResult.user) {
        this.logger.log(`✅ Email já cadastrado - Usuário: ${checkResult.user.name}`);

        // Pegar telefone da API se existir
        const apiPhoneNumber = checkResult.user.phoneNumber;
        if (apiPhoneNumber) {
          this.logger.log(`📞 Telefone da API: ${apiPhoneNumber}`);
          // Atualizar data com telefone da API para usar na validação
          data.phoneNumber = apiPhoneNumber;
        } else {
          this.logger.warn(`⚠️ Usuário da API não tem telefone cadastrado`);
          // Se não tem telefone na API, tentar usar o coletado no onboarding
          if (data.realPhoneNumber) {
            data.phoneNumber = data.realPhoneNumber;
            this.logger.log(`📞 Usando telefone do onboarding: ${data.realPhoneNumber}`);
          }
        }

        // Enviar código de verificação - usar telefone disponível ou platformId
        const phoneForAuth = data.phoneNumber || phoneNumber;
        this.logger.log(`📞 Telefone para autenticação: ${phoneForAuth}`);

        await this.gastoCertoApi.requestAuthCode({
          email: data.email,
          phoneNumber: phoneForAuth,
          source: data.platform || 'telegram',
        });

        return {
          exists: true,
          userId: checkResult.user.id,
          message: `✅ *Email já cadastrado!*\n\nEncontramos uma conta com o email *${data.email}*\n\n📧 Enviamos um código de verificação de 6 dígitos para seu email.\n\nPor favor, digite o código para vincular este número ao seu cadastro:`,
        };
      }

      this.logger.log(`✅ Email disponível - Novo usuário`);
      return { exists: false };
    } catch (error: any) {
      this.logger.error('Erro ao verificar usuário existente:', error);
      throw error;
    }
  }

  /**
   * Monta mensagem de confirmação
   */
  private getConfirmationMessage(data: any): string {
    return `✅ *Confirme seus dados:*\n\n👤 Nome: *${data.name}*\n📧 Email: *${data.email}*\n\n❓ Está tudo correto? Digite *sim* para confirmar ou *não* para corrigir.`;
  }

  /**
   * Verifica se usuário está em processo de onboarding
   */
  async isInOnboarding(phoneNumber: string): Promise<boolean> {
    this.logger.log(`🔍 [ONBOARDING CHECK] Checking isInOnboarding for: ${phoneNumber}`);
    const session = await this.onboardingState.getActiveSession(phoneNumber);
    const result = session !== null && !session.completed;

    this.logger.log(
      `🔍 [ONBOARDING CHECK] isInOnboarding(${phoneNumber}): ${result}\n` +
        `  - session found: ${session !== null}\n` +
        `  - session id: ${session?.id}\n` +
        `  - currentStep: ${session?.currentStep}\n` +
        `  - completed: ${session?.completed}`,
    );

    return result;
  }

  /**
   * Verifica se usuário está em processo de onboarding (alias para Telegram)
   */
  async isUserOnboarding(userId: string): Promise<boolean> {
    return this.isInOnboarding(userId);
  }

  /**
   * Verifica se usuário já está cadastrado no sistema
   */
  async checkUserExists(userId: string): Promise<boolean> {
    try {
      const cachedUser = await this.userCache.getUser(userId);
      return cachedUser !== null;
    } catch (error) {
      this.logger.error(`Error checking if user ${userId} exists:`, error);
      return false;
    }
  }

  /**
   * Inicia processo de onboarding
   */
  async startOnboarding(
    userId: string,
    platform?: 'telegram' | 'whatsapp',
  ): Promise<OnboardingResponse> {
    this.logger.log(
      `🚀 [START ONBOARDING] Starting onboarding for ${userId} on platform ${platform}`,
    );
    const response = await this.onboardingState.startOnboarding(userId, platform);
    this.logger.log(
      `✅ [START ONBOARDING] Onboarding response: completed=${response.completed}, step=${response.currentStep}`,
    );
    return response;
  }

  /**
   * Reativa usuário inativo iniciando onboarding em REQUEST_VERIFICATION_CODE
   */
  async reactivateUser(userId: string, platform?: 'telegram' | 'whatsapp'): Promise<void> {
    const response = await this.onboardingState.reactivateUser(userId, platform);

    // Enviar mensagem inicial
    const eventName = platform === 'telegram' ? 'telegram.reply' : 'session.reply';
    this.eventEmitter.emit(eventName, {
      platformId: userId,
      message: response.message,
      context: 'ONBOARDING',
      platform: platform === 'telegram' ? MessagingPlatform.TELEGRAM : MessagingPlatform.WHATSAPP,
    });
  }

  /**
   * Processa etapa do onboarding e retorna mensagem de resposta
   */
  async processOnboardingStep(userId: string, message: string, metadata?: any): Promise<string> {
    const result = await this.processOnboardingMessage(userId, message, metadata);
    return result.response.message || 'Erro ao processar mensagem.';
  }

  /**
   * Cancela onboarding em andamento
   */
  async cancelOnboarding(platformId: string): Promise<void> {
    try {
      await this.prisma.onboardingSession.updateMany({
        where: {
          platformId,
          completed: false,
        },
        data: {
          completed: true,
        },
      });

      this.logger.log(`Onboarding cancelado: ${platformId}`);
    } catch (error) {
      this.logger.error('Erro ao cancelar onboarding:', error);
    }
  }

  /**
   * Reativa usuário se ele estava inativo após completar onboarding
   */
  private async reactivateUserIfNeeded(platformId: string): Promise<void> {
    try {
      const user = await this.userCache.getUser(platformId);

      if (user && !user.isActive) {
        this.logger.log(`🔄 Reativando usuário inativo: ${platformId} (${user.name})`);

        // Atualizar no cache local usando gastoCertoId
        await this.prisma.userCache.update({
          where: { gastoCertoId: user.gastoCertoId },
          data: {
            isActive: true,
            lastSyncAt: new Date(),
          },
        });

        // Limpar cache Redis para forçar recarregamento
        await this.userCache.invalidateUser(platformId);

        this.logger.log(`✅ Usuário ${user.name} (${platformId}) reativado com sucesso`);
      }
    } catch (error) {
      this.logger.error(`Erro ao reativar usuário ${platformId}:`, error);
      // Não lançar erro - não queremos bloquear o fluxo de onboarding
    }
  }

  /**
   * Finaliza onboarding para usuário que já está ativo
   * Usado quando usuário é ativado manualmente mas tem sessão de onboarding pendente
   */
  async completeOnboardingForActiveUser(platformId: string): Promise<void> {
    try {
      const user = await this.userCache.getUser(platformId);

      if (!user) {
        this.logger.warn(`Usuário ${platformId} não encontrado no cache`);
        return;
      }

      if (!user.isActive) {
        this.logger.warn(
          `Usuário ${platformId} não está ativo, não pode finalizar onboarding automaticamente`,
        );
        return;
      }

      // Finalizar qualquer sessão de onboarding pendente
      await this.onboardingState.completeOnboarding(platformId);

      // 🆕 LIMPAR CACHE para forçar recarregamento com estado atualizado
      await this.userCache.invalidateUser(platformId);

      this.logger.log(
        `✅ Onboarding finalizado automaticamente para usuário ATIVO: ${user.name} (${platformId})`,
      );
    } catch (error) {
      this.logger.error(`Erro ao finalizar onboarding para usuário ativo ${platformId}:`, error);
    }
  }
}
