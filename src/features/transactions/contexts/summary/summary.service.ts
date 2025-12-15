import { Injectable, Logger } from '@nestjs/common';
import { GastoCertoApiService } from '@shared/gasto-certo-api.service';
import { AIProviderFactory } from '@infrastructure/ai/ai-provider.factory';
import { UserCache } from '@prisma/client';
import {
  SUMMARY_INTENT_SYSTEM_PROMPT,
  SUMMARY_GENERATION_PROMPT,
} from './prompts/summary-intent.prompt';

export interface SummaryRequest {
  summaryType: 'monthly' | 'credit_card_invoice' | 'category_breakdown' | 'balance';
  monthReference?: string; // "2024-12"
  category?: string;
}

export interface MonthlySummary {
  monthReference: string;
  totalIncome: number;
  totalExpense: number;
  balance: number;
  topCategories: { category: string; amount: number; percentage: number }[];
  transactionCount: number;
  averagePerDay: number;
}

/**
 * TransactionSummaryService
 *
 * Responsável pelo contexto de RESUMOS e ANÁLISES:
 * - Resumo mensal (receitas, despesas, balanço)
 * - Fatura do cartão de crédito
 * - Análise por categoria
 * - Balanço geral
 */
@Injectable()
export class TransactionSummaryService {
  private readonly logger = new Logger(TransactionSummaryService.name);

  constructor(
    private readonly gastoCertoApi: GastoCertoApiService,
    private readonly aiFactory: AIProviderFactory,
  ) {}

  /**
   * Gera resumo baseado na solicitação
   */
  async generateSummary(
    user: UserCache,
    summaryRequest: SummaryRequest,
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    try {
      this.logger.log(
        `📊 [Summary] Gerando resumo para ${user.phoneNumber}: ${JSON.stringify(summaryRequest)}`,
      );

      switch (summaryRequest.summaryType) {
        case 'monthly':
          return await this.generateMonthlySummary(user, summaryRequest.monthReference);

        case 'credit_card_invoice':
          return await this.generateCreditCardSummary(user, summaryRequest.monthReference);

        case 'category_breakdown':
          return await this.generateCategoryBreakdown(user, summaryRequest.monthReference);

        case 'balance':
          return await this.generateBalanceSummary(user);

        default:
          return {
            success: false,
            message:
              '❓ Não entendi o tipo de resumo.\n\n' +
              'Você pode pedir:\n' +
              '• "Resumo do mês"\n' +
              '• "Fatura do cartão"\n' +
              '• "Balanço geral"\n' +
              '• "Gastos por categoria"',
          };
      }
    } catch (error) {
      this.logger.error(`❌ Erro ao gerar resumo:`, error);
      return {
        success: false,
        message: '❌ Erro ao gerar resumo. Tente novamente.',
      };
    }
  }

  /**
   * Gera resumo mensal completo
   */
  private async generateMonthlySummary(
    user: UserCache,
    monthReference?: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const targetMonth = monthReference || this.getCurrentMonthReference();

      this.logger.log(`📊 Gerando resumo mensal: ${targetMonth}`);

      const result = await this.gastoCertoApi.getMonthlySummary(user.gastoCertoId, targetMonth);

      if (!result.success || !result.data) {
        return {
          success: false,
          message: '❌ Erro ao buscar dados do resumo mensal.',
        };
      }

      const summary: MonthlySummary = result.data;

      // TODO: Implementar formatação com IA (futuro)
      // Usar formato manual por enquanto
      return {
        success: true,
        message: this.formatMonthlySummaryManual(summary, targetMonth),
      };
    } catch (error) {
      this.logger.error(`❌ Erro ao gerar resumo mensal:`, error);
      return {
        success: false,
        message: '❌ Erro ao gerar resumo mensal.',
      };
    }
  }

  /**
   * Gera resumo da fatura do cartão
   */
  private async generateCreditCardSummary(
    user: UserCache,
    monthReference?: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const targetMonth = monthReference || this.getCurrentMonthReference();

      this.logger.log(`💳 Gerando fatura do cartão: ${targetMonth}`);

      const result = await this.gastoCertoApi.listCreditCardInvoices(user.gastoCertoId, 'CLOSED');

      if (!result.success || !result.invoices || result.invoices.length === 0) {
        return {
          success: false,
          message: '❌ Erro ao buscar fatura do cartão.',
        };
      }

      const invoice = result.invoices[0]; // Primeira fatura fechada

      if (invoice.transactions.length === 0) {
        return {
          success: true,
          message:
            `💳 *Fatura do Cartão - ${this.formatMonthYear(targetMonth)}*\n\n` +
            '✅ Nenhuma transação no cartão de crédito este mês.',
        };
      }

      let message = `💳 *Fatura do Cartão*\n`;
      message += `📅 ${this.formatMonthYear(targetMonth)}\n\n`;
      message += `💵 *Total:* R$ ${invoice.total.toFixed(2)}\n`;
      message += `📊 *Transações:* ${invoice.transactions.length}\n`;
      message += `📅 *Vencimento:* ${invoice.dueDate}\n\n`;
      message += '───────────────────\n\n';

      // Agrupar por categoria
      const byCategory = this.groupByCategory(invoice.transactions);
      message += '📂 *Por Categoria:*\n\n';

      Object.entries(byCategory)
        .sort(([, a], [, b]) => b - a)
        .forEach(([category, amount]) => {
          const percentage = (amount / invoice.total) * 100;
          message += `${this.getCategoryEmoji(category)} ${category}\n`;
          message += `   💸 R$ ${amount.toFixed(2)} (${percentage.toFixed(1)}%)\n\n`;
        });

      return {
        success: true,
        message,
      };
    } catch (error) {
      this.logger.error(`❌ Erro ao gerar fatura:`, error);
      return {
        success: false,
        message: '❌ Erro ao gerar fatura do cartão.',
      };
    }
  }

  /**
   * Gera análise detalhada por categoria
   */
  private async generateCategoryBreakdown(
    user: UserCache,
    monthReference?: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      const targetMonth = monthReference || this.getCurrentMonthReference();

      this.logger.log(`📊 Gerando análise por categoria: ${targetMonth}`);

      const result = await this.gastoCertoApi.getCategoryBreakdown(user.gastoCertoId, targetMonth);

      if (!result.success || !result.data) {
        return {
          success: false,
          message: '❌ Erro ao buscar análise por categoria.',
        };
      }

      const breakdown = result.data;

      let message = `📊 *Análise por Categoria*\n`;
      message += `📅 ${this.formatMonthYear(targetMonth)}\n\n`;

      // Despesas
      if (breakdown.expenses && breakdown.expenses.length > 0) {
        message += `💸 *Despesas* (R$ ${breakdown.totalExpenses.toFixed(2)})\n\n`;
        breakdown.expenses.forEach((cat) => {
          const percentage = (cat.amount / breakdown.totalExpenses) * 100;
          message += `${this.getCategoryEmoji(cat.category)} ${cat.category}\n`;
          message += `   R$ ${cat.amount.toFixed(2)} • ${percentage.toFixed(1)}%\n`;
          message += `   📊 ${cat.count} transações\n\n`;
        });
      }

      // Receitas
      if (breakdown.income && breakdown.income.length > 0) {
        message += `\n💰 *Receitas* (R$ ${breakdown.totalIncome.toFixed(2)})\n\n`;
        breakdown.income.forEach((cat) => {
          const percentage = (cat.amount / breakdown.totalIncome) * 100;
          message += `${this.getCategoryEmoji(cat.category)} ${cat.category}\n`;
          message += `   R$ ${cat.amount.toFixed(2)} • ${percentage.toFixed(1)}%\n`;
          message += `   📊 ${cat.count} transações\n\n`;
        });
      }

      return {
        success: true,
        message,
      };
    } catch (error) {
      this.logger.error(`❌ Erro ao gerar análise:`, error);
      return {
        success: false,
        message: '❌ Erro ao gerar análise por categoria.',
      };
    }
  }

  /**
   * Gera resumo do balanço geral
   */
  private async generateBalanceSummary(
    user: UserCache,
  ): Promise<{ success: boolean; message: string }> {
    try {
      this.logger.log(`💰 Gerando balanço geral para ${user.phoneNumber}`);

      const result = await this.gastoCertoApi.getOverallBalance(user.gastoCertoId);

      if (!result.success || !result.data) {
        return {
          success: false,
          message: '❌ Erro ao buscar balanço geral.',
        };
      }

      const balance = result.data;

      let message = `💰 *Balanço Geral*\n\n`;
      message += `📅 Atualizado: ${new Date().toLocaleDateString('pt-BR')}\n\n`;
      message += '───────────────────\n\n';
      message += `💵 *Receitas Totais:* R$ ${balance.totalIncome.toFixed(2)}\n`;
      message += `💸 *Despesas Totais:* R$ ${balance.totalExpenses.toFixed(2)}\n\n`;

      const finalBalance = balance.totalIncome - balance.totalExpenses;
      const balanceEmoji = finalBalance >= 0 ? '✅' : '⚠️';
      message += `${balanceEmoji} *Saldo:* R$ ${finalBalance.toFixed(2)}\n\n`;

      if (balance.pendingPayments && balance.pendingPayments > 0) {
        message += `⏳ *Pagamentos Pendentes:* R$ ${balance.pendingPayments.toFixed(2)}\n\n`;
      }

      // Adicionar dicas
      if (finalBalance < 0) {
        message +=
          '\n💡 _Suas despesas estão maiores que suas receitas. Considere revisar seus gastos._';
      } else if (finalBalance > 0) {
        message += '\n✨ _Ótimo! Você está economizando. Continue assim!_';
      }

      return {
        success: true,
        message,
      };
    } catch (error) {
      this.logger.error(`❌ Erro ao gerar balanço:`, error);
      return {
        success: false,
        message: '❌ Erro ao gerar balanço geral.',
      };
    }
  }

  /**
   * Formato manual do resumo mensal (fallback)
   */
  private formatMonthlySummaryManual(summary: MonthlySummary, monthRef: string): string {
    let message = `📊 *Resumo de ${this.formatMonthYear(monthRef)}*\n\n`;
    message += '───────────────────\n\n';
    message += `💰 *Receitas:* R$ ${summary.totalIncome.toFixed(2)}\n`;
    message += `💸 *Despesas:* R$ ${summary.totalExpense.toFixed(2)}\n`;

    const balanceEmoji = summary.balance >= 0 ? '✅' : '⚠️';
    message += `${balanceEmoji} *Saldo:* R$ ${summary.balance.toFixed(2)}\n\n`;

    message += `📊 *Total de Transações:* ${summary.transactionCount}\n`;
    message += `📈 *Média por Dia:* R$ ${summary.averagePerDay.toFixed(2)}\n\n`;

    if (summary.topCategories && summary.topCategories.length > 0) {
      message += '🏆 *Top Categorias:*\n\n';
      summary.topCategories.slice(0, 5).forEach((cat, index) => {
        message += `${index + 1}. ${this.getCategoryEmoji(cat.category)} ${cat.category}\n`;
        message += `   R$ ${cat.amount.toFixed(2)} (${cat.percentage.toFixed(1)}%)\n\n`;
      });
    }

    return message;
  }

  /**
   * Agrupa transações por categoria
   */
  private groupByCategory(transactions: any[]): Record<string, number> {
    return transactions.reduce(
      (acc, t) => {
        acc[t.category] = (acc[t.category] || 0) + t.amount;
        return acc;
      },
      {} as Record<string, number>,
    );
  }

  /**
   * Retorna emoji para categoria
   */
  private getCategoryEmoji(category: string): string {
    const emojiMap: Record<string, string> = {
      alimentação: '🍔',
      transporte: '🚗',
      saúde: '💊',
      educação: '📚',
      lazer: '🎬',
      moradia: '🏠',
      vestuário: '👔',
      outros: '📦',
      salário: '💵',
      investimentos: '📈',
    };
    return emojiMap[category.toLowerCase()] || '📂';
  }

  /**
   * Retorna referência do mês atual (YYYY-MM)
   */
  private getCurrentMonthReference(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  /**
   * Formata mês/ano para exibição
   */
  private formatMonthYear(monthReference: string): string {
    const [year, month] = monthReference.split('-');
    const monthNames = [
      'Janeiro',
      'Fevereiro',
      'Março',
      'Abril',
      'Maio',
      'Junho',
      'Julho',
      'Agosto',
      'Setembro',
      'Outubro',
      'Novembro',
      'Dezembro',
    ];
    return `${monthNames[parseInt(month) - 1]}/${year}`;
  }
}
