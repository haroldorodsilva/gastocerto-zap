import { Injectable, Logger, Optional, forwardRef, Inject } from '@nestjs/common';
import { RAGLearningService } from '@infrastructure/rag/services/rag-learning.service';
import { TransactionRegistrationService } from './contexts/registration/registration.service';
import { UserCacheService } from '@features/users/user-cache.service';
import { UserCache } from '@prisma/client';

/**
 * MessageLearningService
 *
 * Serviço centralizado para gerenciar o fluxo de aprendizado inteligente do RAG.
 *
 * RESPONSABILIDADES:
 * - Verificar se há contexto de aprendizado pendente
 * - Processar respostas do usuário (1/2/3)
 * - Processar correções manuais
 * - Coordenar com TransactionRegistrationService para processar transação original
 *
 * HANDLERS (WhatsApp/Telegram) apenas:
 * - Extraem dados da plataforma
 * - Delegam para este serviço
 * - Enviam resposta formatada
 *
 * LÓGICA DE NEGÓCIO centralizada aqui!
 */
@Injectable()
export class MessageLearningService {
  private readonly logger = new Logger(MessageLearningService.name);

  constructor(
    private readonly ragLearningService: RAGLearningService,
    @Optional()
    @Inject(forwardRef(() => TransactionRegistrationService))
    private readonly transactionRegistrationService?: TransactionRegistrationService,
    private readonly userCacheService?: UserCacheService,
  ) {
    this.logger.log(
      `🎓 [MessageLearningService] Inicializado com: ` +
        `ragLearningService=${!!ragLearningService}, ` +
        `transactionRegistrationService=${!!transactionRegistrationService}, ` +
        `userCacheService=${!!userCacheService}`,
    );
  }

  /**
   * Verifica se usuário tem contexto de aprendizado pendente
   */
  async hasPendingLearning(phoneNumber: string): Promise<{ hasPending: boolean; context?: any }> {
    if (!this.ragLearningService) {
      return { hasPending: false };
    }

    const hasPending = await this.ragLearningService.hasPendingContext(phoneNumber);
    const context = hasPending ? await this.ragLearningService.getContext(phoneNumber) : null;

    return { hasPending, context };
  }

  /**
   * Processa mensagem quando há contexto de aprendizado pendente
   *
   * @returns Objeto com success/message para handlers
   */
  async processLearningMessage(
    phoneNumber: string,
    messageText: string,
    accountId?: string, // accountId contextual
  ): Promise<{
    success: boolean;
    message: string;
    shouldProcessOriginalTransaction?: boolean;
    originalText?: string;
    overrideCategory?: {
      categoryId?: string;
      categoryName?: string;
      subCategoryId?: string;
      subCategoryName?: string;
    };
  }> {
    if (!this.ragLearningService) {
      return { success: false, message: '❌ Serviço de aprendizado indisponível.' };
    }

    // Buscar usuário
    const user = await this.userCacheService.getUser(phoneNumber);
    if (!user) {
      return { success: false, message: '❌ Usuário não encontrado.' };
    }

    // Usar accountId passado ou fallback para activeAccountId do usuário
    const effectiveAccountId = accountId || user.activeAccountId;
    if (!effectiveAccountId) {
      return { success: false, message: '❌ Conta não identificada.' };
    }

    // Tentar processar como resposta (1/2/3)
    const response = await this.ragLearningService.processResponse(
      phoneNumber,
      messageText,
      user.gastoCertoId,
    );

    if (response.processed) {
      if (response.action === 'confirmed') {
        // Usuário confirmou - usar originalText do response
        return {
          success: true,
          message: response.message,
          shouldProcessOriginalTransaction: true,
          originalText: response.originalText, // Já vem do processResponse
        };
      } else if (response.action === 'rejected') {
        // Usuário rejeitou - pedir correção
        return {
          success: true,
          message: response.message,
          shouldProcessOriginalTransaction: false,
        };
      } else if (response.action === 'cancelled') {
        // Cancelado
        return {
          success: true,
          message: response.message,
          shouldProcessOriginalTransaction: false,
        };
      }
    }

    // Não processou como resposta - tentar como correção manual
    const categories = await this.userCacheService.getUserCategories(
      phoneNumber,
      effectiveAccountId, // Usar accountId contextual
    );

    const correctionResult = await this.ragLearningService.processCorrection(
      phoneNumber,
      messageText,
      user.gastoCertoId,
      categories.categories,
    );

    if (correctionResult.success) {
      // Correção aceita - retornar originalText e categoria selecionada
      return {
        success: true,
        message: correctionResult.message,
        shouldProcessOriginalTransaction: correctionResult.shouldContinue,
        originalText: correctionResult.originalText,
        overrideCategory: correctionResult.selectedCategoryId
          ? {
              categoryId: correctionResult.selectedCategoryId,
              categoryName: correctionResult.selectedCategoryName,
              subCategoryId: correctionResult.selectedSubcategoryId,
              subCategoryName: correctionResult.selectedSubcategoryName,
            }
          : undefined,
      };
    } else {
      // Correção inválida
      return {
        success: true,
        message:
          correctionResult.message ||
          '⚠️ Formato inválido.\n\nUse: "Categoria > Subcategoria"\nOu só: "Subcategoria"',
        shouldProcessOriginalTransaction: false,
      };
    }
  }

  /**
   * Processa transação após confirmação/correção de aprendizado
   */
  async processOriginalTransaction(
    phoneNumber: string,
    originalText: string,
    messageId: string,
    user: UserCache,
    platform: string = 'whatsapp',
    accountId?: string,
    overrideCategory?: {
      categoryId?: string;
      categoryName?: string;
      subCategoryId?: string;
      subCategoryName?: string;
    },
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    if (!this.transactionRegistrationService) {
      return {
        success: false,
        message: '❌ Serviço de transações indisponível.',
      };
    }

    try {
      // ⚠️ IMPORTANTE: skipLearning=true para evitar loop infinito
      const result = await this.transactionRegistrationService.processTextTransaction(
        phoneNumber,
        originalText,
        messageId,
        user,
        platform,
        accountId, // accountId: passado pelo caller (ex: webchat)
        true, // skipLearning: não verificar learning novamente
        overrideCategory, // Categoria escolhida pelo usuário no learning flow
      );

      return {
        success: result.success,
        message: result.message,
      };
    } catch (error) {
      this.logger.error('Erro ao processar transação original:', error);
      return {
        success: false,
        message: '❌ Erro ao processar transação. Tente novamente.',
      };
    }
  }

  /**
   * Detecta se mensagem precisa confirmação de aprendizado
   * Chamado ANTES de processar transação normalmente
   */
  async detectAndPrepareConfirmation(
    phoneNumber: string,
    text: string,
    extractedData: any,
  ): Promise<{
    needsConfirmation: boolean;
    message?: string;
  }> {
    this.logger.debug(
      `🎓 [MessageLearningService] detectAndPrepareConfirmation chamado: phone=${phoneNumber}, text="${text}"`,
    );
    this.logger.debug(
      `🎓 [MessageLearningService] ragLearningService disponível: ${!!this.ragLearningService}`,
    );

    if (!this.ragLearningService) {
      this.logger.warn(`⚠️ [MessageLearningService] ragLearningService não está disponível!`);
      return { needsConfirmation: false };
    }

    // Buscar usuário
    const user = await this.userCacheService.getUser(phoneNumber);
    if (!user) {
      this.logger.warn(`⚠️ [MessageLearningService] Usuário não encontrado: ${phoneNumber}`);
      return { needsConfirmation: false };
    }

    this.logger.debug(
      `🎓 [MessageLearningService] Chamando RAGLearningService.detectAndPrepareConfirmation...`,
    );

    const detection = await this.ragLearningService.detectAndPrepareConfirmation(
      text,
      user.gastoCertoId,
      phoneNumber,
      extractedData,
    );

    this.logger.debug(
      `🎓 [MessageLearningService] Resultado: needsConfirmation=${detection.needsConfirmation}`,
    );

    return {
      needsConfirmation: detection.needsConfirmation,
      message: detection.message,
    };
  }
}
