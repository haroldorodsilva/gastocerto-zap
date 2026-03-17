import { Injectable, Logger } from '@nestjs/common';
import { TransactionConfirmation } from '@prisma/client';
import { MessageIntent } from '@features/intent/intent-analyzer.service';
import { RAGService } from '@infrastructure/rag/services/rag.service';
import { TransactionConfirmationService } from '../transaction-confirmation.service';
import { TransactionRegistrationService } from '../contexts/registration/registration.service';
import { ListContextService, ListContextItem } from '../list-context.service';
import { IntentHandler, IntentHandlerContext } from './intent-handler.interface';
import { ProcessMessageResult } from '../transactions.types';

/**
 * Handler para intents de confirmação de transações
 *
 * Intents: CONFIRMATION_RESPONSE, LIST_PENDING
 * Delega para: TransactionConfirmationService, TransactionRegistrationService
 */
@Injectable()
export class ConfirmationIntentHandler implements IntentHandler {
  private readonly logger = new Logger(ConfirmationIntentHandler.name);

  readonly supportedIntents = [MessageIntent.CONFIRMATION_RESPONSE, MessageIntent.LIST_PENDING];

  constructor(
    private readonly confirmationService: TransactionConfirmationService,
    private readonly registrationService: TransactionRegistrationService,
    private readonly ragService: RAGService,
    private readonly listContext: ListContextService,
  ) {}

  async handle(ctx: IntentHandlerContext): Promise<ProcessMessageResult> {
    const { text, intentResult } = ctx;
    const phoneNumber = ctx.user.phoneNumber;

    switch (intentResult.intent) {
      case MessageIntent.CONFIRMATION_RESPONSE: {
        this.logger.log('✅ Delegando para processConfirmation');
        const result = await this.processConfirmation(phoneNumber, text, {
          userId: ctx.user.gastoCertoId,
          accountId: ctx.accountId,
        });
        return {
          success: result.success,
          message: result.message,
          requiresConfirmation: false,
          replyContext: 'TRANSACTION_RESULT',
        };
      }

      case MessageIntent.LIST_PENDING: {
        this.logger.log('✅ Delegando para listPendingConfirmations');
        const result = await this.listPendingConfirmations(phoneNumber);
        return {
          success: result.success,
          message: result.message,
          requiresConfirmation: false,
          replyContext: 'TRANSACTION_RESULT',
        };
      }

      default:
        return {
          success: false,
          message: '❌ Intenção de confirmação não reconhecida.',
          requiresConfirmation: false,
          replyContext: 'ERROR',
        };
    }
  }

  /**
   * Processa confirmação de transação (sim/não/trocar)
   * Chains: confirmationService.processResponse → registrationService.registerConfirmedTransaction
   */
  async processConfirmation(
    phoneNumber: string,
    response: string,
    extraCtx?: { userId?: string; accountId?: string },
  ): Promise<{ success: boolean; message: string }> {
    try {
      this.logger.log(`✅ Processando confirmação: ${response}`);

      const result = await this.confirmationService.processResponse(phoneNumber, response);

      if (result.action === 'invalid') {
        return {
          success: false,
          message: '❓ Não há transação pendente de confirmação.',
        };
      }

      if (result.action === 'rejected') {
        return {
          success: true,
          message: '❌ Ok, transação cancelada.',
        };
      }

      if (result.action === 'confirmed' && result.confirmation) {
        return await this.registrationService.registerConfirmedTransaction(result.confirmation);
      }

      if (result.action === 'change_category' && result.confirmation) {
        this.logger.log(`🔄 Usuário pediu troca de categoria para confirmação ${result.confirmation.id}`);
        return await this.showCategoryChoice(
          phoneNumber,
          result.confirmation,
          extraCtx?.userId,
          extraCtx?.accountId,
        );
      }

      return {
        success: false,
        message: '❓ Não entendi sua resposta. Por favor, responda com "sim", "não" ou "trocar".',
      };
    } catch (error) {
      this.logger.error('Erro ao processar confirmação:', error);
      return {
        success: false,
        message: '❌ Erro ao processar confirmação. Tente novamente.',
      };
    }
  }

  /**
   * Mostra lista de categorias disponíveis para o usuário escolher
   */
  private async showCategoryChoice(
    phoneNumber: string,
    confirmation: TransactionConfirmation,
    userId?: string,
    accountId?: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const effectiveUserId = userId || confirmation.userId || '';
      const effectiveAccountId = accountId || confirmation.accountId || '';

      let categories: any[] = [];

      if (effectiveUserId) {
        const allCategories = await this.ragService.getCachedCategories(effectiveUserId);
        categories = effectiveAccountId
          ? allCategories.filter((cat) => cat.accountId === effectiveAccountId)
          : allCategories;
      }

      if (categories.length === 0) {
        return {
          success: false,
          message:
            '❌ Não encontrei categorias disponíveis.\n\n' +
            'Use *"sim"* para confirmar ou *"não"* para cancelar.',
        };
      }

      // Construir itens de lista com metadata
      const items: ListContextItem[] = categories.map((cat) => ({
        id: cat.id,
        type: 'category' as const,
        description: cat.subCategory ? `${cat.name} > ${cat.subCategory.name}` : cat.name,
        category: cat.name,
        metadata: {
          category: cat.subCategory ? `${cat.name} > ${cat.subCategory.name}` : cat.name,
          categoryId: cat.id,
          subCategoryId: cat.subCategory?.id || null,
          subCategoryName: cat.subCategory?.name || null,
          confirmationId: confirmation.id,
        },
      }));

      // Armazenar contexto para seleção por número
      this.listContext.setListContext(phoneNumber, 'category_correction', items);

      // Construir mensagem de seleção
      let message = `🏷️ *Escolha a categoria correta:*\n\n`;
      items.forEach((item, i) => {
        message += `*${i + 1}.* ${item.description}\n`;
      });
      message += `\n_Responda com o número da categoria desejada_`;

      return { success: true, message };
    } catch (error) {
      this.logger.error('Erro ao mostrar opções de categoria:', error);
      return {
        success: false,
        message: '❌ Erro ao buscar categorias. Tente responder com "sim" ou "não".',
      };
    }
  }

  /**
   * Lista transações pendentes de confirmação
   */
  async listPendingConfirmations(
    phoneNumber: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      this.logger.log(`📋 Listando confirmações pendentes de ${phoneNumber}`);

      const pending = await this.confirmationService.getAllPendingConfirmations(phoneNumber);

      if (!pending || pending.length === 0) {
        return {
          success: true,
          message: '✅ Você não tem transações pendentes de confirmação.',
        };
      }

      const { DateUtil } = await import('../../../utils/date.util');

      let message = `📋 *Transações Pendentes de Confirmação*\n\n`;
      message += `Você tem ${pending.length} transação(ões) aguardando:\n\n`;

      pending.forEach((conf, index) => {
        const typeEmoji = conf.type === 'EXPENSES' ? '💸' : '💰';
        const amount = (Number(conf.amount) / 100).toFixed(2);
        const extractedData = conf.extractedData as any;

        message += `${index + 1}. ${typeEmoji} *R$ ${amount}*\n`;
        message += `   📂 ${conf.category}\n`;
        if (extractedData?.merchant) {
          message += `   🏪 ${extractedData.merchant}\n`;
        }
        message += `   📅 ${DateUtil.formatBR(conf.date)}\n\n`;
      });

      message += `💡 *Digite "sim" para confirmar a primeira, ou "não" para cancelar.*`;

      return { success: true, message };
    } catch (error) {
      this.logger.error('Erro ao listar pendentes:', error);
      return {
        success: false,
        message: '❌ Erro ao buscar transações pendentes.',
      };
    }
  }
}
