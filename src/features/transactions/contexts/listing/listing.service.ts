import { Injectable, Logger } from '@nestjs/common';
import { GastoCertoApiService } from '@shared/gasto-certo-api.service';
import { UserCache } from '@prisma/client';
import { AccountManagementService } from '@features/accounts/account-management.service';

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
  category: string;
  description?: string;
  date: string;
  merchant?: string;
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

      // 2. Buscar transações na API
      const result = await this.gastoCertoApi.listTransactions(user.gastoCertoId, {
        monthYear: `${dateRange.startDate.substring(0, 7)}`,
        type: filters.type,
        categoryId: filters.category,
        limit: filters.limit || 20,
      });

      if (!result.success) {
        return {
          success: false,
          message: '❌ Erro ao buscar transações. Tente novamente mais tarde.',
        };
      }

      const transactions = result.transactions || [];

      // 3. Verificar se há transações
      if (transactions.length === 0) {
        return {
          success: true,
          message: this.formatEmptyListMessage(filters),
          transactions: [],
        };
      }

      // 4. Formatar mensagem de listagem
      const message = this.formatTransactionList(transactions, filters);

      return {
        success: true,
        message,
        transactions,
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
    transactions: TransactionListItem[],
    filters: ListingFilters,
  ): string {
    const { type, category, period } = filters;

    // Cabeçalho
    let message = '📋 *Transações*\n\n';

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

    // Calcular totais
    const totalExpenses = transactions
      .filter((t) => t.type === 'EXPENSES')
      .reduce((sum, t) => sum + t.amount, 0);

    const totalIncome = transactions
      .filter((t) => t.type === 'INCOME')
      .reduce((sum, t) => sum + t.amount, 0);

    // Resumo
    message += `💵 *Total:* ${transactions.length} transações\n`;
    if (totalExpenses > 0) {
      message += `💸 *Gastos:* R$ ${totalExpenses.toFixed(2)}\n`;
    }
    if (totalIncome > 0) {
      message += `💰 *Receitas:* R$ ${totalIncome.toFixed(2)}\n`;
    }
    message += '\n';

    // Lista de transações
    message += '───────────────────\n\n';

    transactions.slice(0, filters.limit || 20).forEach((t, index) => {
      const emoji = t.type === 'EXPENSES' ? '💸' : '💰';
      const date = new Date(t.date).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
      });

      message += `${index + 1}. ${emoji} *R$ ${t.amount.toFixed(2)}*\n`;
      message += `   📂 ${t.category}`;
      if (t.description) {
        message += ` • ${t.description}`;
      }
      message += `\n   📅 ${date}`;
      if (t.merchant) {
        message += ` • 🏪 ${t.merchant}`;
      }
      message += '\n\n';
    });

    if (transactions.length > (filters.limit || 20)) {
      message += `_Mostrando ${filters.limit || 20} de ${transactions.length} transações_\n`;
    }

    return message.trim();
  }

  /**
   * Formata mensagem quando não há transações
   */
  private formatEmptyListMessage(filters: ListingFilters): string {
    let message = '📭 *Nenhuma transação encontrada*\n\n';

    if (filters.category) {
      message += `Não há transações na categoria *${filters.category}*`;
    } else if (filters.type) {
      const typeText = filters.type === 'EXPENSES' ? 'gastos' : 'receitas';
      message += `Não há ${typeText} registrados`;
    } else {
      message += 'Você ainda não tem transações registradas';
    }

    const periodText = {
      today: 'hoje',
      week: 'esta semana',
      month: 'este mês',
      last_month: 'no mês passado',
    };

    if (filters.period && periodText[filters.period]) {
      message += ` ${periodText[filters.period]}`;
    }

    message += '.\n\n';
    message += '_Para registrar, envie:_\n';
    message += '💬 "Gastei R$ 50 em alimentação"';

    return message;
  }
}
