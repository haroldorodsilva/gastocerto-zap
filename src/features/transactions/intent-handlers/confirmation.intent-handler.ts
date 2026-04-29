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
        const result = await this.listPendingConfirmations(phoneNumber, ctx.accountId);
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

      // Tentar detecção inline de categoria: "não, foi X", "era X", "na verdade é X"
      const inlineTerm = this.extractInlineCategoryTerm(response);
      if (inlineTerm && (extraCtx?.userId || extraCtx?.accountId)) {
        const inlineResult = await this.tryInlineCategoryUpdate(
          phoneNumber,
          inlineTerm,
          extraCtx?.userId,
          extraCtx?.accountId,
        );
        if (inlineResult) return inlineResult;
        // Se não encontrou match → cai no fluxo normal (mostra lista)
      }

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
   * Extrai termo de categoria de mensagens do tipo:
   * "não, foi alimentação", "era transporte", "na verdade é saúde", "foi lazer"
   * Retorna null se não detectar o padrão.
   */
  private extractInlineCategoryTerm(text: string): string | null {
    const normalized = text.trim().toLowerCase();

    const patterns = [
      /^n(?:ã|a)o[,\s]+foi\s+(.+)$/,       // "não, foi X" / "nao foi X"
      /^n(?:ã|a)o[,\s]+(?:é|e)\s+(.+)$/,   // "não, é X"
      /^era\s+(.+)$/,                         // "era X"
      /^na verdade[,\s]+(?:é|foi|era|e)?\s*(.+)$/,  // "na verdade é X" / "na verdade X"
      /^foi\s+([a-záãâàéêèíîìóõôòúûùç][^\s].+)$/,  // "foi X" (min 2 palavras para evitar falso positivo)
      /^(?:é|e)\s+([a-záãâàéêèíîìóõôòúûùç][^\s].+)$/,  // "é X" (min 2 palavras)
      /^corrigir[,\s]+(?:para\s+)?(.+)$/,   // "corrigir para X"
    ];

    for (const pattern of patterns) {
      const match = normalized.match(pattern);
      if (match?.[1]) {
        const term = match[1].trim().replace(/[?!.,;]+$/, '');
        if (term.length >= 3) return term;
      }
    }
    return null;
  }

  /**
   * Busca categorias da conta ativa e tenta match fuzzy com o termo.
   * Se achar, atualiza a confirmação pendente e retorna mensagem atualizada.
   * Se não achar, retorna null (cai no fluxo normal de lista).
   */
  private async tryInlineCategoryUpdate(
    phoneNumber: string,
    term: string,
    userId?: string,
    accountId?: string,
  ): Promise<{ success: boolean; message: string } | null> {
    try {
      const effectiveUserId = userId || '';
      if (!effectiveUserId) return null;

      const allCategories = await this.ragService.getCachedCategories(effectiveUserId, accountId || null);
      if (!allCategories.length) return null;

      // Fuzzy match: verificar se term está contido no nome da categoria ou subcategoria
      const termNorm = term.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

      let bestMatch: { categoryId: string; categoryName: string; subCategoryId: string | null; subCategoryName: string | null } | null = null;
      let bestScore = 0;

      for (const cat of allCategories) {
        const catNorm = cat.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

        // Match na categoria principal
        if (catNorm === termNorm) {
          bestMatch = { categoryId: cat.id, categoryName: cat.name, subCategoryId: null, subCategoryName: null };
          bestScore = 100;
          break;
        }
        if (catNorm.includes(termNorm) && termNorm.length / catNorm.length > bestScore / 100) {
          const score = (termNorm.length / catNorm.length) * 80;
          if (score > bestScore) {
            bestScore = score;
            bestMatch = { categoryId: cat.id, categoryName: cat.name, subCategoryId: null, subCategoryName: null };
          }
        }

        // Match na subcategoria
        if (cat.subCategory) {
          const subNorm = cat.subCategory.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          if (subNorm === termNorm) {
            bestMatch = { categoryId: cat.id, categoryName: cat.name, subCategoryId: cat.subCategory.id, subCategoryName: cat.subCategory.name };
            bestScore = 100;
            break;
          }
          if (subNorm.includes(termNorm) && termNorm.length / subNorm.length > bestScore / 100) {
            const score = (termNorm.length / subNorm.length) * 90; // subcategoria tem peso maior
            if (score > bestScore) {
              bestScore = score;
              bestMatch = { categoryId: cat.id, categoryName: cat.name, subCategoryId: cat.subCategory.id, subCategoryName: cat.subCategory.name };
            }
          }
        }
      }

      // Threshold mínimo: 50% de match
      if (!bestMatch || bestScore < 50) return null;

      const confirmation = await this.confirmationService.getPendingConfirmation(phoneNumber, accountId);
      if (!confirmation) return null;

      const categoryLabel = bestMatch.subCategoryName
        ? `${bestMatch.categoryName} > ${bestMatch.subCategoryName}`
        : bestMatch.categoryName;

      const updated = await this.confirmationService.updateCategory(
        confirmation.id,
        bestMatch.categoryName,
        bestMatch.categoryId,
        bestMatch.subCategoryId,
        bestMatch.subCategoryName,
      );

      this.logger.log(`🔄 Categoria inline atualizada para "${categoryLabel}" (score=${bestScore.toFixed(0)}%)`);

      const confirmMsg = this.confirmationService.formatConfirmationMessage(updated);
      return {
        success: true,
        message: `✅ Categoria alterada para *${categoryLabel}*!\n\n${confirmMsg}`,
      };
    } catch (err) {
      this.logger.warn(`[inline-category] Erro ao tentar match: ${err.message}`);
      return null;
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
        // Pass accountId so the cache lookup uses the account-scoped key (n:m fix)
        const allCategories = await this.ragService.getCachedCategories(effectiveUserId, effectiveAccountId || null);
        categories = allCategories;
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
    accountId?: string | null,
  ): Promise<{ success: boolean; message: string }> {
    try {
      this.logger.log(`📋 Listando confirmações pendentes de ${phoneNumber}`);

      const pending = await this.confirmationService.getAllPendingConfirmations(phoneNumber, accountId);

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
