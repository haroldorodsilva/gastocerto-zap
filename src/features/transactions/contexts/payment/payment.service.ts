import { Injectable, Logger } from '@nestjs/common';
import { GastoCertoApiService } from '@shared/gasto-certo-api.service';
import { UserCache } from '@prisma/client';
import { AccountManagementService } from '@features/accounts/account-management.service';
import { ListContextService, ListContextItem } from '../../list-context.service';

export interface PaymentRequest {
  paymentType: 'credit_card' | 'bill' | 'transaction_id' | 'pending_list';
  transactionId?: string;
  category?: string;
  monthReference?: string; // "2024-12"
}

/**
 * TransactionPaymentService
 *
 * Responsável pelo contexto de PAGAMENTO de transações:
 * - Pagar contas pendentes
 * - Quitar faturas de cartão de crédito
 * - Pagar transação específica por ID
 * - Listar contas pendentes
 */
@Injectable()
export class TransactionPaymentService {
  private readonly logger = new Logger(TransactionPaymentService.name);

  constructor(
    private readonly gastoCertoApi: GastoCertoApiService,
    private readonly accountManagement: AccountManagementService,
    private readonly listContext: ListContextService,
  ) {}

  /**
   * Processa solicitação de pagamento
   */
  async processPayment(
    user: UserCache,
    paymentRequest: PaymentRequest,
  ): Promise<{
    success: boolean;
    message: string;
  }> {
    try {
      this.logger.log(
        `💳 [Payment] Processando pagamento para ${user.phoneNumber}: ${JSON.stringify(paymentRequest)}`,
      );

      // 0. Validar conta ativa
      const validation = await this.accountManagement.validateActiveAccount(user.phoneNumber);
      if (!validation.valid) {
        return {
          success: false,
          message: validation.message,
        };
      }

      switch (paymentRequest.paymentType) {
        case 'credit_card':
          return await this.payCreditCardInvoice(user, paymentRequest.monthReference);

        case 'transaction_id':
          if (!paymentRequest.transactionId) {
            return {
              success: false,
              message: '❌ ID da transação não informado.',
            };
          }
          return await this.paySpecificTransaction(user, paymentRequest.transactionId);

        case 'bill':
          return await this.payBillByCategory(user, paymentRequest.category);

        case 'pending_list':
          return await this.listPendingPayments(user);

        default:
          return {
            success: false,
            message:
              '❓ Não entendi o tipo de pagamento.\n\n' +
              'Você pode:\n' +
              '• "Pagar fatura do cartão"\n' +
              '• "Ver contas pendentes"\n' +
              '• "Pagar conta de luz"',
          };
      }
    } catch (error) {
      this.logger.error(`❌ Erro ao processar pagamento:`, error);
      return {
        success: false,
        message: '❌ Erro ao processar pagamento. Tente novamente.',
      };
    }
  }

  /**
   * Paga fatura do cartão de crédito
   */
  private async payCreditCardInvoice(
    user: UserCache,
    monthReference?: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      // Se não informou o mês, usa mês atual
      const targetMonth = monthReference || this.getCurrentMonthReference();

      this.logger.log(`💳 Buscando fatura do cartão para ${targetMonth}`);

      // Buscar faturas de crédito
      const result = await this.gastoCertoApi.listCreditCardInvoices(
        user.activeAccountId,
        user.gastoCertoId, // TODO: Passar creditCardId real quando disponível
      );

      if (!result.success || !result.data || result.data.length === 0) {
        return {
          success: false,
          message: '❌ Nenhuma fatura encontrada para o mês.',
        };
      }

      const invoice = result.data[0]; // Primeira fatura fechada

      if (!invoice || invoice.transactions.length === 0) {
        return {
          success: true,
          message:
            `📋 *Fatura do Cartão - ${this.formatMonthYear(targetMonth)}*\n\n` +
            '✅ Nenhuma transação pendente no cartão de crédito este mês.',
        };
      }

      // Formatar fatura
      let message = `💳 *Fatura do Cartão - ${this.formatMonthYear(targetMonth)}*\n\n`;
      message += `💵 *Total:* R$ ${invoice.total.toFixed(2)}\n`;
      message += `📊 *Transações:* ${invoice.transactions.length}\n`;
      message += `📅 *Vencimento:* ${invoice.dueDate}\n\n`;
      message += '───────────────────\n\n';

      invoice.transactions.forEach((t, index) => {
        message += `${index + 1}. 💸 *R$ ${t.amount.toFixed(2)}*\n`;
        message += `   📂 ${t.category}`;
        if (t.description) {
          message += ` • ${t.description}`;
        }
        message += `\n   📅 ${new Date(t.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`;
        if (t.merchant) {
          message += ` • 🏪 ${t.merchant}`;
        }
        message += '\n\n';
      });

      message += '\n💡 _Para pagar, use o app ou sistema bancário._';

      return {
        success: true,
        message,
      };
    } catch (error) {
      this.logger.error(`❌ Erro ao buscar fatura:`, error);
      return {
        success: false,
        message: '❌ Erro ao buscar fatura do cartão.',
      };
    }
  }

  /**
   * Paga item da lista por número (contexto)
   */
  async payItemByNumber(
    user: UserCache,
    itemNumber: number,
  ): Promise<{ success: boolean; message: string }> {
    try {
      this.logger.log(`🔢 Tentando pagar item #${itemNumber} para ${user.phoneNumber}`);

      // Buscar item do contexto
      const result = this.listContext.getItemByNumber(user.phoneNumber, itemNumber);

      if (!result.found || !result.item) {
        return {
          success: false,
          message: result.message || '❌ Item não encontrado.',
        };
      }

      const item = result.item;

      // Verificar tipo do item
      if (item.type !== 'payment') {
        return {
          success: false,
          message:
            `❌ O item #${itemNumber} não é uma conta pendente de pagamento.\n\n` +
            `É do tipo: ${item.type}\n\n` +
            `Use *"ver pendentes"* para listar contas que podem ser pagas.`,
        };
      }

      // Pagar a transação
      this.logger.log(`💰 Pagando transação ${item.id} (${item.description})`);
      const payResult = await this.paySpecificTransaction(user, item.id);

      // Limpar contexto após pagamento bem-sucedido
      if (payResult.success) {
        this.listContext.clearContext(user.phoneNumber);
      }

      return payResult;
    } catch (error) {
      this.logger.error(`❌ Erro ao pagar item por número:`, error);
      return {
        success: false,
        message: '❌ Erro ao processar pagamento.',
      };
    }
  }

  /**
   * Paga transação específica por ID
   */
  private async paySpecificTransaction(
    user: UserCache,
    transactionId: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      this.logger.log(`💰 Marcando transação ${transactionId} como paga`);

      const result = await this.gastoCertoApi.payTransaction(
        user.gastoCertoId,
        transactionId,
      );

      if (result.success) {
        return {
          success: true,
          message: `✅ *Transação marcada como paga!*\n\n🆔 ID: ${transactionId}`,
        };
      } else {
        return {
          success: false,
          message: `❌ Erro ao marcar transação como paga.\n\n${result.error || 'Transação não encontrada'}`,
        };
      }
    } catch (error) {
      this.logger.error(`❌ Erro ao pagar transação:`, error);
      return {
        success: false,
        message: '❌ Erro ao processar pagamento da transação.',
      };
    }
  }

  /**
   * Paga conta por categoria (luz, água, etc)
   */
  private async payBillByCategory(
    user: UserCache,
    category?: string,
  ): Promise<{ success: boolean; message: string }> {
    if (!category) {
      return {
        success: false,
        message:
          '❓ Qual conta você quer pagar?\n\n' +
          'Exemplos:\n' +
          '• "Pagar conta de luz"\n' +
          '• "Pagar água"\n' +
          '• "Pagar telefone"',
      };
    }

    try {
      this.logger.log(`🧾 Buscando contas pendentes na categoria: ${category}`);

      const result = await this.gastoCertoApi.getPendingBillsByCategory(
        user.gastoCertoId,
        category,
      );

      if (!result.success || !result.data || result.data.length === 0) {
        return {
          success: true,
          message: `✅ Nenhuma conta pendente de *${category}*.`,
        };
      }

      const bills = result.data;
      let message = `🧾 *Contas Pendentes - ${category}*\n\n`;

      bills.forEach((bill, index) => {
        message += `${index + 1}. 💸 *R$ ${bill.amount.toFixed(2)}*\n`;
        message += `   📅 Vencimento: ${bill.dueDate}\n`;
        if (bill.description) {
          message += `   📝 ${bill.description}\n`;
        }
        message += `   🆔 ID: ${bill.id}\n\n`;
      });

      message += '\n💡 _Para pagar, responda com o número ou ID da conta._';

      return {
        success: true,
        message,
      };
    } catch (error) {
      this.logger.error(`❌ Erro ao buscar contas:`, error);
      return {
        success: false,
        message: '❌ Erro ao buscar contas pendentes.',
      };
    }
  }

  /**
   * Lista todas as contas/transações pendentes de pagamento
   */
  private async listPendingPayments(
    user: UserCache,
  ): Promise<{ success: boolean; message: string }> {
    try {
      this.logger.log(`📋 Listando pagamentos pendentes para ${user.phoneNumber}`);

      const result = await this.gastoCertoApi.getPendingPayments(user.gastoCertoId);

      if (!result.success || !result.data || result.data.length === 0) {
        return {
          success: true,
          message:
            '✅ *Parabéns!*\n\n' + 'Você não tem contas ou transações pendentes de pagamento.',
        };
      }

      const pending = result.data;

      // ✅ ARMAZENAR CONTEXTO DE LISTA
      const contextItems: ListContextItem[] = pending.items.map((item) => ({
        id: item.id,
        type: 'payment' as const,
        description: item.description || item.category,
        amount: item.amount,
        category: item.category,
        metadata: {
          dueDate: item.dueDate,
        },
      }));

      this.listContext.setListContext(user.phoneNumber, 'pending_payments', contextItems);

      let message = `📋 *Contas Pendentes*\n\n`;
      message += `💵 *Total:* R$ ${pending.total.toFixed(2)}\n`;
      message += `📊 *Quantidade:* ${pending.items.length}\n\n`;
      message += '───────────────────\n\n';

      pending.items.forEach((item, index) => {
        message += `${index + 1}. 💸 *R$ ${item.amount.toFixed(2)}*\n`;
        message += `   📂 ${item.category}`;
        if (item.description) {
          message += ` • ${item.description}`;
        }
        message += `\n   📅 Vencimento: ${item.dueDate}\n`;
        message += `   🆔 ID: ${item.id}\n\n`;
      });

      message += '\n💡 _Para pagar, responda: *"pagar 1"* ou *"pagar 5"*_';

      return {
        success: true,
        message,
      };
    } catch (error) {
      this.logger.error(`❌ Erro ao listar pendentes:`, error);
      return {
        success: false,
        message: '❌ Erro ao buscar pagamentos pendentes.',
      };
    }
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
