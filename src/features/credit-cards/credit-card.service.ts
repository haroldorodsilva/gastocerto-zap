import { Injectable, Logger } from '@nestjs/common';
import { GastoCertoApiService } from '@shared/gasto-certo-api.service';
import { UserCache } from '@prisma/client';
import { AccountManagementService } from '@features/accounts/account-management.service';
import { ListContextService, ListContextItem } from '../transactions/list-context.service';

/**
 * CreditCardService
 *
 * Responsável pelo gerenciamento de cartões de crédito:
 * - Listar cartões do usuário
 * - Listar faturas de um cartão
 * - Ver detalhes de uma fatura específica
 * - Pagar fatura de cartão (invoice)
 */
@Injectable()
export class CreditCardService {
  private readonly logger = new Logger(CreditCardService.name);

  constructor(
    private readonly gastoCertoApi: GastoCertoApiService,
    private readonly accountManagement: AccountManagementService,
    private readonly listContext: ListContextService,
  ) {}

  /**
   * Lista todos os cartões de crédito do usuário
   */
  async listCreditCards(
    user: UserCache,
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    try {
      this.logger.log(`💳 Listando cartões de crédito para ${user.phoneNumber}`);

      // Validar conta ativa
      const validation = await this.accountManagement.validateActiveAccount(user.phoneNumber);
      if (!validation.valid || !validation.account) {
        return {
          success: false,
          message: validation.message,
        };
      }

      const result = await this.gastoCertoApi.listCreditCards(validation.account.id);

      if (!result.success || !result.data || result.data.length === 0) {
        return {
          success: true,
          message:
            '💳 *Seus Cartões de Crédito*\n\n' +
            '📭 Você ainda não tem cartões cadastrados.\n\n' +
            '💡 _Cadastre um cartão no app para começar a usar!_',
        };
      }

      const cards = result.data;

      // Armazenar contexto de lista
      const contextItems: ListContextItem[] = cards.map((card) => ({
        id: card.id,
        type: 'credit_card' as const,
        description: card.name,
        amount: card.limit / 100, // Converter centavos para reais
        category: card.bankName,
        metadata: {
          closingDay: card.closingDay,
          dueDay: card.dueDay,
        },
      }));

      this.listContext.setListContext(user.phoneNumber, 'credit_cards', contextItems);

      // Formatar mensagem
      let message = `💳 *Seus Cartões de Crédito*\n\n`;
      message += `📊 *Total:* ${cards.length} cartão(ões)\n\n`;
      message += '───────────────────\n\n';

      cards.forEach((card, index) => {
        message += `${index + 1}. 💳 *${card.name}*\n`;
        message += `   🏦 ${card.bankName}\n`;
        message += `   💰 Limite: R$ ${(card.limit / 100).toFixed(2)}\n`;
        message += `   📅 Fechamento: dia ${card.closingDay}\n`;
        message += `   📅 Vencimento: dia ${card.dueDay}\n\n`;
      });

      message += '\n💡 _Para ver as faturas, digite: "faturas do cartão"_';

      return {
        success: true,
        message,
      };
    } catch (error) {
      this.logger.error(`❌ Erro ao listar cartões:`, error);
      return {
        success: false,
        message: '❌ Erro ao buscar cartões de crédito.',
      };
    }
  }

  /**
   * Lista faturas de cartão de crédito
   */
  async listInvoices(
    user: UserCache,
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    try {
      this.logger.log(`📋 Listando faturas para ${user.phoneNumber}`);

      // Validar conta ativa
      const validation = await this.accountManagement.validateActiveAccount(user.phoneNumber);
      if (!validation.valid || !validation.account) {
        return {
          success: false,
          message: validation.message,
        };
      }

      // Primeiro, buscar cartões
      const cardsResult = await this.gastoCertoApi.listCreditCards(validation.account.id);

      if (!cardsResult.success || !cardsResult.data || cardsResult.data.length === 0) {
        return {
          success: false,
          message:
            '💳 *Cartões de Crédito*\n\n' +
            '📭 Você não tem cartões cadastrados.\n\n' +
            '💡 _Cadastre um cartão no app para começar!_',
        };
      }

      // Para cada cartão, buscar faturas
      const allInvoices: any[] = [];

      for (const card of cardsResult.data) {
        try {
          const invoicesResult = await this.gastoCertoApi.listCreditCardInvoices(
            validation.account.id,
            card.id,
          );

          if (invoicesResult.success && invoicesResult.data) {
            allInvoices.push(
              ...invoicesResult.data.map((invoice: any) => ({
                ...invoice,
                cardName: card.name,
                cardId: card.id,
              })),
            );
          }
        } catch (err) {
          this.logger.warn(`Erro ao buscar faturas do cartão ${card.name}:`, err);
        }
      }

      if (allInvoices.length === 0) {
        return {
          success: true,
          message:
            '📋 *Faturas de Cartão*\n\n' +
            '✅ Não há faturas abertas ou pendentes no momento.\n\n' +
            '💡 _Suas faturas aparecerão aqui quando houver transações no cartão._',
        };
      }

      // Ordenar por data de vencimento
      allInvoices.sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

      // Armazenar contexto
      const contextItems: ListContextItem[] = allInvoices.map((invoice) => ({
        id: invoice.id,
        type: 'invoice' as const,
        description: `${invoice.cardName} - ${this.formatMonthYear(invoice.yearMonth)}`,
        amount: invoice.total / 100,
        category: invoice.cardName,
        metadata: {
          yearMonth: invoice.yearMonth,
          status: invoice.status,
          dueDate: invoice.dueDate,
          cardId: invoice.cardId,
        },
      }));

      this.listContext.setListContext(user.phoneNumber, 'invoices', contextItems);

      // Formatar mensagem
      let message = `💳 *Faturas de Cartão*\n\n`;
      message += `📊 *Total:* ${allInvoices.length} fatura(s)\n\n`;
      message += '───────────────────\n\n';

      allInvoices.forEach((invoice, index) => {
        const statusEmoji = this.getStatusEmoji(invoice.status);
        const amountInReais = invoice.total / 100;

        message += `${index + 1}. 💳 *${invoice.cardName}*\n`;
        message += `   📅 ${this.formatMonthYear(invoice.yearMonth)}\n`;
        message += `   💰 *R$ ${amountInReais.toFixed(2)}*\n`;
        message += `   ${statusEmoji} ${this.translateStatus(invoice.status)}\n`;
        message += `   📆 Vence: ${new Date(invoice.dueDate).toLocaleDateString('pt-BR')}\n`;
        message += `   📊 ${invoice.transactions} transação(ões)\n\n`;
      });

      message +=
        '\n💡 _Para ver detalhes, digite: "ver fatura 1"_\n' +
        '💡 _Para pagar, digite: "pagar fatura 1"_';

      return {
        success: true,
        message,
      };
    } catch (error) {
      this.logger.error(`❌ Erro ao listar faturas:`, error);
      return {
        success: false,
        message: '❌ Erro ao buscar faturas de cartão.',
      };
    }
  }

  /**
   * Mostra detalhes de uma fatura específica
   */
  async showInvoiceDetails(
    user: UserCache,
    invoiceNumber: number,
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    try {
      this.logger.log(`📄 Mostrando detalhes da fatura #${invoiceNumber}`);

      // Buscar fatura do contexto
      const result = this.listContext.getItemByNumber(user.phoneNumber, invoiceNumber);

      if (!result.found || !result.item || result.item.type !== 'invoice') {
        return {
          success: false,
          message:
            '❌ *Fatura não encontrada*\n\n' +
            'Use *"minhas faturas"* para ver a lista de faturas disponíveis.',
        };
      }

      const invoice = result.item;

      // Buscar detalhes completos da fatura via API
      const validation = await this.accountManagement.validateActiveAccount(user.phoneNumber);
      if (!validation.valid || !validation.account) {
        return {
          success: false,
          message: validation.message,
        };
      }

      const detailsResult = await this.gastoCertoApi.getInvoiceDetails(
        validation.account.id,
        invoice.id,
      );

      if (!detailsResult.success || !detailsResult.data) {
        return {
          success: false,
          message: '❌ Não foi possível carregar os detalhes da fatura.',
        };
      }

      const details = detailsResult.data;

      // Formatar mensagem igual "minhas transações"
      let message = `💳 *Detalhes da Fatura*\n\n`;
      message += `🏦 *Cartão:* ${details.creditCardName}\n`;
      message += `📅 *Período:* ${this.formatMonthYear(details.yearMonth)}\n`;
      message += `💰 *Total:* R$ ${(details.totalAmount / 100).toFixed(2)}\n`;
      message += `📆 *Vencimento:* ${new Date(details.dueDate).toLocaleDateString('pt-BR')}\n`;
      message += `📊 *Status:* ${this.translateStatus(details.status)}\n\n`;
      message += '───────────────────\n\n';

      // Listar transações
      if (details.transactions && details.transactions.length > 0) {
        message += `📋 *Transações (${details.transactions.length}):*\n\n`;

        details.transactions.forEach((t: any, index: number) => {
          const label = t.description || t.categoryName || 'Sem descrição';
          const amountInReais = Math.abs(t.amount) / 100;

          message += `${index + 1}. ${label}\n`;
          message += `   🔴 *R$ ${amountInReais.toFixed(2)}*\n`;
          message += `   📂 ${t.categoryName || 'Sem categoria'}`;

          if (t.merchantName) {
            message += ` • 🏪 ${t.merchantName}`;
          }
          message += '\n';
          message += `   📅 ${new Date(t.date).toLocaleDateString('pt-BR')}\n\n`;
        });
      } else {
        message += '📭 Nenhuma transação nesta fatura.\n\n';
      }

      message += `\n💡 _Para pagar esta fatura, digite: "pagar fatura ${invoiceNumber}"_`;

      return {
        success: true,
        message,
      };
    } catch (error) {
      this.logger.error(`❌ Erro ao mostrar detalhes da fatura:`, error);
      return {
        success: false,
        message: '❌ Erro ao carregar detalhes da fatura.',
      };
    }
  }

  /**
   * Paga uma fatura de cartão (invoice)
   */
  async payInvoice(
    user: UserCache,
    invoiceNumber: number,
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    try {
      this.logger.log(`💰 Pagando fatura #${invoiceNumber}`);

      // Buscar fatura do contexto
      const result = this.listContext.getItemByNumber(user.phoneNumber, invoiceNumber);

      if (!result.found || !result.item || result.item.type !== 'invoice') {
        return {
          success: false,
          message:
            '❌ *Fatura não encontrada*\n\n' +
            'Use *"minhas faturas"* para ver a lista de faturas disponíveis.',
        };
      }

      const invoice = result.item;

      // Validar conta ativa
      const validation = await this.accountManagement.validateActiveAccount(user.phoneNumber);
      if (!validation.valid || !validation.account) {
        return {
          success: false,
          message: validation.message,
        };
      }

      // Converter reais para centavos
      const amount = Math.round(invoice.amount * 100);

      this.logger.log(`💰 Pagando fatura ${invoice.id} - amount: ${amount} centavos`);

      // Chamar API para pagar fatura (invoice)
      const payResult = await this.gastoCertoApi.payInvoice(
        validation.account.id,
        invoice.id,
        amount,
      );

      if (payResult.success) {
        // Limpar contexto após sucesso
        this.listContext.clearContext(user.phoneNumber);

        return {
          success: true,
          message:
            `✅ *Fatura paga com sucesso!*\n\n` +
            `💳 *Cartão:* ${invoice.category}\n` +
            `📅 *Período:* ${this.formatMonthYear(invoice.metadata.yearMonth)}\n` +
            `💰 *Valor:* R$ ${invoice.amount.toFixed(2)}\n\n` +
            `📝 A fatura foi marcada como paga no sistema.`,
        };
      } else {
        return {
          success: false,
          message:
            '❌ *Não foi possível pagar a fatura*\n\n' +
            'Verifique se a fatura ainda está aberta.\n\n' +
            '💡 _Tente novamente ou entre em contato com o suporte._',
        };
      }
    } catch (error) {
      this.logger.error(`❌ Erro ao pagar fatura:`, error);
      return {
        success: false,
        message:
          '❌ *Erro ao processar pagamento*\n\n' +
          'Ocorreu um problema ao tentar pagar esta fatura.\n\n' +
          '💡 _Tente novamente em alguns instantes._',
      };
    }
  }

  /**
   * Helpers de formatação
   */
  private formatMonthYear(yearMonth: string): string {
    const [year, month] = yearMonth.split('-');
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

  private getStatusEmoji(status: string): string {
    const statusMap: Record<string, string> = {
      OPEN: '🔵',
      CLOSED: '🟡',
      PAID: '✅',
      OVERDUE: '🔴',
    };
    return statusMap[status] || '⚪';
  }

  private translateStatus(status: string): string {
    const statusMap: Record<string, string> = {
      OPEN: 'Aberta',
      CLOSED: 'Fechada',
      PAID: 'Paga',
      OVERDUE: 'Vencida',
    };
    return statusMap[status] || status;
  }
}
