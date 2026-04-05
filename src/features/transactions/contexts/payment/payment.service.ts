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
        user.defaultCreditCardId || user.gastoCertoId,
      );

      if (!result.success || !result.invoices || result.invoices.length === 0) {
        return {
          success: false,
          message: '❌ Nenhuma fatura encontrada para o mês.',
        };
      }

      const invoice = result.invoices[0]; // Primeira fatura fechada

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
      message += `💵 *Total:* R$ ${(invoice.amountTotal / 100).toFixed(2)}\n`;
      message += `📊 *Transações:* ${invoice.transactions?.length || 0}\n`;
      message += `📅 *Vencimento:* ${invoice.dueDate}\n\n`;
      message += '───────────────────\n\n';

      invoice.transactions?.forEach((t, index) => {
        message += `${index + 1}. 💸 *R$ ${(Math.abs(t.amount) / 100).toFixed(2)}*\n`;
        message += `   📂 ${t.category?.name || 'Sem categoria'}`;
        if (t.description) {
          message += ` • ${t.description}`;
        }
        message += `\n   📅 ${new Date(t.dueDate).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`;
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
  async paySpecificTransaction(
    user: UserCache,
    transactionId: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      this.logger.log(`💰 Marcando transação ${transactionId} como paga`);
      this.logger.log(`   📋 user.activeAccountId (cache): ${user.activeAccountId}`);

      // Buscar conta ativa
      const activeAccount = await this.accountManagement.validateActiveAccount(user.phoneNumber);
      if (!activeAccount.valid || !activeAccount.account) {
        return {
          success: false,
          message: '❌ Você precisa ter uma conta ativa para pagar transações.',
        };
      }

      this.logger.log(`   ✅ activeAccount.id (validado): ${activeAccount.account.id}`);
      this.logger.log(`   👤 userId: ${user.gastoCertoId}`);

      const result = await this.gastoCertoApi.payTransaction(
        user.gastoCertoId,
        activeAccount.account.id,
        transactionId,
      );

      if (result.success) {
        return {
          success: true,
          message: `✅ *Transação marcada como paga!*`, //🆔 ID: ${transactionId}
        };
      } else {
        // Mensagem amigável - NUNCA expor detalhes técnicos
        return {
          success: false,
          message:
            '❌ *Não foi possível marcar a transação como paga*\n\n' +
            'Verifique se a transação existe e não foi paga anteriormente.\n\n' +
            '💡 _Tente novamente ou entre em contato com o suporte._',
        };
      }
    } catch (error) {
      this.logger.error(`❌ Erro ao pagar transação:`, error);
      return {
        success: false,
        message:
          '❌ *Erro ao processar pagamento*\n\n' +
          'Ocorreu um problema ao tentar pagar esta transação.\n\n' +
          '💡 _Tente novamente em alguns instantes._',
      };
    }
  }

  /**
   * Paga conta por categoria (luz, água, etc)
   * NOTA: Este método requer um categoryId (UUID), não um nome de categoria
   * TODO: Implementar mapeamento de nome para categoryId
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

      // TEMPORÁRIO: Retornar mensagem informando que precisa usar categoryId
      return {
        success: false,
        message:
          '⚠️ *Funcionalidade em manutenção*\n\n' +
          'Por favor, use "minhas transações" para ver suas transações pendentes.',
      };

      // TODO: Implementar busca de categoryId por nome ou refatorar para usar outro filtro
      // const result = await this.gastoCertoApi.getPendingBillsByCategory(
      //   user.activeAccountId,
      //   categoryId, // precisa do UUID da categoria
      // );
    } catch (error: any) {
      this.logger.error(`❌ Erro ao buscar contas pendentes:`, error);
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

      const result = await this.gastoCertoApi.getPendingPayments(
        user.gastoCertoId,
        user.activeAccountId,
      );

      // Erro de API (conexão/servidor)
      if (!result.success) {
        this.logger.error(`❌ API retornou erro: ${result.error || 'Erro desconhecido'}`);
        return {
          success: false,
          message:
            '❌ *Não foi possível buscar as transações pendentes*\n\n' +
            'O servidor está temporariamente indisponível.\n\n' +
            '💡 _Tente novamente em alguns instantes._',
        };
      }

      // Lista vazia (sucesso, mas sem transações)
      if (!result.data || !result.data.data || result.data.data.length === 0) {
        return {
          success: true,
          message:
            '✅ *Parabéns!*\n\n' + 'Você não tem contas ou transações pendentes de pagamento.',
        };
      }

      const pending = result.data.data;
      const totalAmount = pending.reduce((sum, item) => sum + (item.amount / 100 || 0), 0);

      // ✅ ARMAZENAR CONTEXTO DE LISTA
      const contextItems: ListContextItem[] = pending.map((item) => ({
        id: item.id,
        type: 'payment' as const,
        description:
          item.description || item.subCategory?.name || item.category?.name || 'Sem descrição',
        amount: item.amount / 100,
        category: item.category?.name || 'Sem categoria',
        metadata: {
          dueDate: item.dueDate,
        },
      }));

      this.listContext.setListContext(user.phoneNumber, 'pending_payments', contextItems);

      // 🎨 FORMATO IGUAL "MINHAS TRANSAÇÕES"
      let message = `📋 *Transações Pendentes*\n\n`;
      message += `💵 *Total:* R$ ${totalAmount.toFixed(2)}\n`;
      message += `📊 *Quantidade:* ${pending.length}\n\n`;
      message += '───────────────────\n\n';

      pending.forEach((item, index) => {
        // 1. Label (description > subcategory > category)
        let label = item.description;
        if (!label) {
          label = item.subCategory?.name || item.category?.name || 'Sem descrição';
        }

        // 2. Parcelamento no label (se houver)
        if (item.installment && item.installmentTotal && item.installmentTotal > 1) {
          label = `${label} (${item.installment}/${item.installmentTotal})`;
        }

        // 3. Valor com emoji de tipo
        const amountInReais = item.amount / 100;
        const typeEmoji = item.type === 'EXPENSES' ? '🔴' : '🟢';

        // 4. Header: Label + Valor
        message += `${index + 1}. ${label}\n`;
        message += `   ${typeEmoji} *R$ ${amountInReais.toFixed(2)}*\n`;

        // 5. Categoria/Subcategoria
        const categoryText = item.subCategory?.name || item.category?.name || 'Sem categoria';
        message += `   📂 ${categoryText}`;

        // 6. Status badges
        const badges: string[] = [];
        if (item.transactionFixedId) {
          badges.push('🔄 Recorrente');
        }
        if (item.origin === 'CARD') {
          badges.push('💳 Cartão');
        }
        badges.push('⏳ Pendente');

        if (badges.length > 0) {
          message += ` • ${badges.join(' ')}`;
        }
        message += '\n';

        // 7. Data de vencimento
        const dueDate = new Date(item.dueDate).toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        });
        message += `   📅 Vencimento: ${dueDate}`;

        // 8. Banco ou Cartão
        if (item.bank?.name) {
          message += ` • 🏦 ${item.bank.name}`;
        } else if (item.creditCard?.name) {
          message += ` • 💳 ${item.creditCard.name}`;
        }

        // 9. ID da transação (para debug/validação)
        // message += `\n   🆔 ID: ${item.id}`;

        message += '\n\n';
      });

      message += '💡 _Para pagar, responda: *"pagar 1"* ou *"pagar 2"*_';

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
