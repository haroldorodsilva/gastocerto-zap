import { Injectable, Logger } from '@nestjs/common';
import { MessageIntent } from '@features/intent/intent-analyzer.service';
import { TransactionPaymentService, PaymentRequest } from '../contexts/payment/payment.service';
import { IntentHandler, IntentHandlerContext } from './intent-handler.interface';
import { ProcessMessageResult } from '../transactions.types';

/**
 * Handler para intents de pagamento
 *
 * Intents: LIST_PENDING_PAYMENTS, PAY_BILL
 * Delega para: TransactionPaymentService
 */
@Injectable()
export class PaymentIntentHandler implements IntentHandler {
  private readonly logger = new Logger(PaymentIntentHandler.name);

  readonly supportedIntents = [MessageIntent.LIST_PENDING_PAYMENTS, MessageIntent.PAY_BILL];

  constructor(private readonly paymentService: TransactionPaymentService) {}

  async handle(ctx: IntentHandlerContext): Promise<ProcessMessageResult> {
    switch (ctx.intentResult.intent) {
      case MessageIntent.LIST_PENDING_PAYMENTS: {
        this.logger.log('✅ Delegando para TransactionPaymentService.listPendingPayments');
        const result = await this.paymentService.processPayment(ctx.user, {
          paymentType: 'pending_list',
        });
        return {
          success: result.success,
          message: result.message,
          requiresConfirmation: false,
          replyContext: 'TRANSACTION_RESULT',
        };
      }

      case MessageIntent.PAY_BILL: {
        this.logger.log('✅ Extraindo intenção de pagamento da mensagem');
        const paymentRequest = this.extractPaymentRequest(ctx.text);
        this.logger.log(`💳 PaymentRequest extraído: ${JSON.stringify(paymentRequest)}`);

        const result = await this.paymentService.processPayment(ctx.user, paymentRequest);
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
          message: '❌ Intenção de pagamento não reconhecida.',
          requiresConfirmation: false,
          replyContext: 'ERROR',
        };
    }
  }

  /**
   * Extrai o tipo de pagamento e detalhes a partir do texto da mensagem.
   * Usa regras simples e rápidas sem custo de IA.
   */
  private extractPaymentRequest(text: string): PaymentRequest {
    const normalized = text.toLowerCase().trim();

    // Detectar intenção de cartão de crédito
    const creditCardPatterns = [
      /fatura/,
      /cartão/,
      /cart[aã]o/,
      /cr[eé]dito/,
      /invoice/,
    ];
    if (creditCardPatterns.some((p) => p.test(normalized))) {
      // Tentar extrair mês de referência (dezembro, jan, 12/2024, etc.)
      const monthReference = this.extractMonthReference(normalized);
      return { paymentType: 'credit_card', monthReference };
    }

    // Detectar pagamento por ID (ex: "pagar transação 12345", "quitar #abc")
    const idMatch = normalized.match(/(?:transa[çc][aã]o|id|#)\s*([a-z0-9\-]{6,})/i);
    if (idMatch) {
      return { paymentType: 'transaction_id', transactionId: idMatch[1] };
    }

    // Detectar categoria de conta
    const billCategories: Record<string, string> = {
      'luz': 'Energia Elétrica',
      'energia': 'Energia Elétrica',
      'água': 'Água',
      'agua': 'Água',
      'gás': 'Gás',
      'gas': 'Gás',
      'telefone': 'Telefone',
      'celular': 'Telefone',
      'internet': 'Internet',
      'aluguel': 'Aluguel',
      'condomínio': 'Condomínio',
      'condominio': 'Condomínio',
      'plano': 'Plano de Saúde',
      'saúde': 'Plano de Saúde',
    };

    for (const [keyword, category] of Object.entries(billCategories)) {
      if (normalized.includes(keyword)) {
        return { paymentType: 'bill', category };
      }
    }

    // Fallback: listar pendentes
    return { paymentType: 'pending_list' };
  }

  /**
   * Extrai referência de mês a partir de texto (ex: "dezembro", "12/2024", "próximo mês")
   */
  private extractMonthReference(text: string): string | undefined {
    const now = new Date();
    const year = now.getFullYear();

    // Formato YYYY-MM ou MM/YYYY
    const explicitMatch = text.match(/(\d{4})[\/\-](\d{2})|(\d{2})[\/\-](\d{4})/);
    if (explicitMatch) {
      const y = explicitMatch[1] || explicitMatch[4];
      const m = explicitMatch[2] || explicitMatch[3];
      return `${y}-${m.padStart(2, '0')}`;
    }

    // Nomes de meses em português
    const months: Record<string, number> = {
      'janeiro': 1, 'fevereiro': 2, 'março': 3, 'abril': 4,
      'maio': 5, 'junho': 6, 'julho': 7, 'agosto': 8,
      'setembro': 9, 'outubro': 10, 'novembro': 11, 'dezembro': 12,
      'jan': 1, 'fev': 2, 'mar': 3, 'abr': 4,
      'mai': 5, 'jun': 6, 'jul': 7, 'ago': 8,
      'set': 9, 'out': 10, 'nov': 11, 'dez': 12,
    };

    for (const [name, month] of Object.entries(months)) {
      if (text.includes(name)) {
        return `${year}-${String(month).padStart(2, '0')}`;
      }
    }

    // Mês atual como padrão
    return `${year}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
}
