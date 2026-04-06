import { Injectable, Logger } from '@nestjs/common';
import { GastoCertoApiService } from '@shared/gasto-certo-api.service';
import { UserCache } from '@prisma/client';
import { AccountManagementService } from '@features/accounts/account-management.service';
import { formatCurrency, formatCurrencyFromCents } from '@/utils/currency';
import { ListTransactionsResponseDto } from '@/shared/types';
import {
  getListingIntro,
  getBalanceComment,
  getEmptyListMessage,
} from '@shared/utils/response-variations';
import { ListContextService } from '../../list-context.service';

export interface ListingFilters {
  period?: 'today' | 'week' | 'month' | 'last_month' | 'custom';
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  category?: string;
  type?: 'EXPENSES' | 'INCOME';
  limit?: number;
}

export interface TransactionListItem {
  id: string;
  type: 'EXPENSES' | 'INCOME';
  amount: number;
  category: string; // STRING - Nome legível (ex: "Alimentação")
  categoryId: string;
  subCategory?: string; // STRING - Nome da subcategoria
  subCategoryId?: string;
  description: string;
  date: string; // YYYY-MM-DD
  dueDate?: string; // YYYY-MM-DD
  paidAt?: string; // ISO 8601
  status: 'PENDING' | 'DONE' | 'OVERDUE';
  accountId: string;
  accountName: string; // STRING - Nome da conta
  paymentMethod?: 'DEBIT_CARD' | 'CREDIT_CARD' | 'PIX' | 'CASH' | 'BANK_TRANSFER' | 'BANK_SLIP';
  installments?: number;
  installmentNumber?: number;
  bankId?: string;
  bankName?: string; // STRING - Nome do banco
  bankAccountType?: 'CHECKING' | 'SAVINGS' | 'INVESTMENT';
  creditCardId?: string;
  creditCardName?: string; // STRING - Nome do cartão
  recurrent?: boolean;
  note?: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

/**
 * TransactionListingService
 *
 * Responsável pelo contexto de LISTAGEM de transações:
 * - Listar transações com filtros
 * - Formatar listagem para mensagem
 * - Aplicar paginação
 * - Buscar por período, categoria, tipo
 */
@Injectable()
export class TransactionListingService {
  private readonly logger = new Logger(TransactionListingService.name);

  constructor(
    private readonly gastoCertoApi: GastoCertoApiService,
    private readonly accountManagement: AccountManagementService,
    private readonly listContext: ListContextService,
  ) {}

  /**
   * Lista transações do usuário aplicando filtros
   */
  async listTransactions(
    user: UserCache,
    filters: ListingFilters,
  ): Promise<{
    success: boolean;
    message: string;
    transactions?: TransactionListItem[];
  }> {
    try {
      this.logger.log(
        `📋 [Listing] Buscando transações para ${user.phoneNumber} com filtros: ${JSON.stringify(filters)}`,
      );

      // 0. Validar conta ativa
      const validation = await this.accountManagement.validateActiveAccount(user.phoneNumber);
      if (!validation.valid) {
        return {
          success: false,
          message: validation.message,
        };
      }

      // 1. Calcular datas baseado no período
      const dateRange = this.calculateDateRange(filters.period, filters.startDate, filters.endDate);
      const filter = {
        accountId: user.activeAccountId,
        monthYear: `${dateRange.startDate.substring(0, 7)}`,
        type: filters.type,
        categoryId: filters.category,
        limit: filters.limit || 100, //TODO: futuramente ver como paginar os registros por mensagem
      };

      // 2. Buscar transações na API

      const result = await this.gastoCertoApi.listTransactions(user.gastoCertoId, filter);
      this.logger.log(`📋 [listTransactions] Resultado da API: ${JSON.stringify(result)}`);

      if (!result.success) {
        return {
          success: false,
          message: '❌ Erro ao buscar transações. Tente novamente mais tarde.',
        };
      }

      const transactions = result.data?.data || [];

      // DEBUG: Log para ver estrutura das transações retornadas
      if (transactions.length > 0) {
        this.logger.debug(`📊 Primeira transação da API: ${JSON.stringify(transactions[0])}`);
      }

      // 3. Verificar se há transações
      if (transactions.length === 0) {
        return {
          success: true,
          message: this.formatEmptyListMessage(filters),
          transactions: [],
        };
      }

      // 4. Armazenar contexto para referência numérica posterior ("pagar 3", "detalhar 2")
      const contextItems = transactions.map((t: any) => ({
        id: t.id || t.gastoCertoId || '',
        type: 'transaction' as const,
        description: t.description || t.category?.name || 'Transação',
        amount: typeof t.amount === 'number' ? t.amount / 100 : t.amount,
        category: t.category?.name || t.categoryName || '',
        metadata: {
          status: t.paymentStatus || t.status,
          date: t.date || t.dueDate,
          type: t.type,
        },
      }));
      this.listContext.setListContext(user.phoneNumber, 'transactions', contextItems);

      // 5. Formatar mensagem de listagem
      const message = this.formatTransactionList(result, filters);

      return {
        success: true,
        message,
      };
    } catch (error) {
      this.logger.error(`❌ Erro ao listar transações:`, error);
      return {
        success: false,
        message: '❌ Erro ao buscar transações. Tente novamente.',
      };
    }
  }

  /**
   * Calcula range de datas baseado no período solicitado
   */
  private calculateDateRange(
    period?: string,
    customStart?: string,
    customEnd?: string,
  ): { startDate: string; endDate: string } {
    const now = new Date();
    let startDate: Date;
    let endDate: Date = now;

    switch (period) {
      case 'today':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;

      case 'week':
        const dayOfWeek = now.getDay();
        startDate = new Date(now);
        startDate.setDate(now.getDate() - dayOfWeek);
        break;

      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        break;

      case 'last_month':
        startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        endDate = new Date(now.getFullYear(), now.getMonth(), 0);
        break;

      case 'custom':
        if (customStart && customEnd) {
          return {
            startDate: customStart,
            endDate: customEnd,
          };
        }
        // Fallback: último mês
        startDate = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
        break;

      default:
        // Default: últimos 30 dias
        startDate = new Date(now);
        startDate.setDate(now.getDate() - 30);
    }

    return {
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
    };
  }

  /**
   * Formata lista de transações para exibição
   */
  private formatTransactionList(
    data: ListTransactionsResponseDto,
    filters: ListingFilters,
  ): string {
    const { type, category, period } = filters;

    const transactions = data.data?.data || [];
    const resume = data.data?.resume;

    // Cabeçalho
    let message = getListingIntro(transactions.length) + '\n\n';

    // Filtros aplicados
    if (type || category || period) {
      message += '🔍 *Filtros:*\n';
      if (type) {
        message += `• Tipo: ${type === 'EXPENSES' ? 'Gastos 💸' : 'Receitas 💰'}\n`;
      }
      if (category) {
        message += `• Categoria: ${category}\n`;
      }
      if (period) {
        const periodLabels = {
          today: 'Hoje',
          week: 'Esta semana',
          month: 'Este mês',
          last_month: 'Mês passado',
        };
        message += `• Período: ${periodLabels[period] || period}\n`;
      }
      message += '\n';
    }

    // Resumo financeiro
    if (resume) {
      message += `💵 *Total:* ${transactions.length} transação${transactions.length !== 1 ? 'ões' : ''}\n`;
      message += `💸 *Gastos:* R$ ${formatCurrencyFromCents(resume.expenseTotal || 0)}\n`;
      message += `💰 *Receitas:* R$ ${formatCurrencyFromCents(resume.incomeTotal || 0)}\n`;
      message += `📊 *Balanço:* R$ ${formatCurrencyFromCents(resume.finalBalance || 0)}\n`;
      message += getBalanceComment(resume.expenseTotal || 0, resume.incomeTotal || 0, resume.finalBalance || 0);
      message += '\n';
    }

    // Lista de transações
    message += '───────────────────\n\n';

    transactions.slice(0, filters.limit || 20).forEach((t, index) => {
      // 1. Definir label (description > subcategory > category)
      let label = t.description;
      if (!label) {
        label = t.subCategory?.name || t.category?.name || 'Sem descrição';
      }

      // 2. Adicionar parcelamento ao label se existir
      if (t.installment && t.installmentTotal && t.installmentTotal > 1) {
        label = `${label} (${t.installment}/${t.installmentTotal})`;
      }

      // 3. Formatar valor com cor (emoji como indicador visual)
      const amountInReais = t.amount / 100;
      const typeEmoji = t.type === 'EXPENSES' ? '🔴' : '🟢';
      const amountFormatted = formatCurrency(amountInReais);

      // 4. Header: Label + Valor
      message += `${index + 1}. ${label}\n`;
      message += `   ${typeEmoji} *R$ ${amountFormatted}*\n`;

      // 5. Categoria/Subcategoria
      const categoryText = t.subCategory?.name || t.category?.name || 'Sem categoria';
      message += `   📂 ${categoryText}`;

      // 6. Status e Tipo
      const statusBadges = this.getStatusBadges(t);
      if (statusBadges) {
        message += ` • ${statusBadges}`;
      }
      message += '\n';

      // 7. Data
      const date = t.dueDate
        ? new Date(t.dueDate).toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
          })
        : '';
      if (date) {
        message += `   📅 ${date}`;
      }

      // 8. Banco ou Cartão
      if (t.bank?.name) {
        message += ` • 🏦 ${t.bank.name}`;
      } else if (t.creditCard?.name) {
        message += ` • 💳 ${t.creditCard.name}`;
      }

      message += '\n\n';
    });

    if (transactions.length > (filters.limit || 20)) {
      message += `_Mostrando ${filters.limit || 20} de ${transactions.length} transações_\n`;
    }

    return message.trim();
  }

  /**
   * Retorna badges de status da transação
   */
  private getStatusBadges(transaction: any): string {
    const badges: string[] = [];

    // Tipo especial
    if (transaction.transactionFixedId) {
      badges.push('🔄 Recorrente');
    } else if (transaction.origin === 'CARD' && transaction.isGrouped) {
      badges.push('💳 Cartão');
    }

    // Status
    switch (transaction.status) {
      case 'PENDING':
        badges.push('⏳ Pendente');
        break;
      case 'DONE':
        badges.push('✅ Pago');
        break;
      case 'OVERDUE':
        badges.push('⚠️ Vencido');
        break;
    }

    return badges.join(' ');
  }

  /**
   * Formata mensagem quando não há transações
   */
  private formatEmptyListMessage(filters: ListingFilters): string {
    const context = filters.category || (filters.type === 'EXPENSES' ? 'gastos' : filters.type === 'INCOME' ? 'receitas' : undefined);
    return getEmptyListMessage(context);
  }
}
