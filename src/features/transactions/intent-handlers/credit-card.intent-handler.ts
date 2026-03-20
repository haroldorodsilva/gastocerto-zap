import { Injectable, Logger } from '@nestjs/common';
import { MessageIntent } from '@features/intent/intent-analyzer.service';
import { CreditCardService } from '../../credit-cards/credit-card.service';
import { IntentHandler, IntentHandlerContext } from './intent-handler.interface';
import { ProcessMessageResult } from '../transactions.types';

/**
 * Handler para intents de cartão de crédito e faturas
 *
 * Intents: LIST_CREDIT_CARDS, SET_DEFAULT_CREDIT_CARD, SHOW_DEFAULT_CREDIT_CARD,
 *          SHOW_INVOICE_BY_CARD_NAME, LIST_INVOICES, SHOW_INVOICE_DETAILS, PAY_INVOICE
 * Delega para: CreditCardService
 */
@Injectable()
export class CreditCardIntentHandler implements IntentHandler {
  private readonly logger = new Logger(CreditCardIntentHandler.name);

  readonly supportedIntents = [
    MessageIntent.LIST_CREDIT_CARDS,
    MessageIntent.SET_DEFAULT_CREDIT_CARD,
    MessageIntent.SHOW_DEFAULT_CREDIT_CARD,
    MessageIntent.SHOW_INVOICE_BY_CARD_NAME,
    MessageIntent.LIST_INVOICES,
    MessageIntent.SHOW_INVOICE_DETAILS,
    MessageIntent.PAY_INVOICE,
  ];

  constructor(private readonly creditCardService: CreditCardService) {}

  async handle(ctx: IntentHandlerContext): Promise<ProcessMessageResult> {
    const { user, text, intentResult } = ctx;

    switch (intentResult.intent) {
      case MessageIntent.LIST_CREDIT_CARDS: {
        this.logger.log('✅ Delegando para CreditCardService.listCreditCards');
        const result = await this.creditCardService.listCreditCards(user);
        return {
          success: result.success,
          message: result.message,
          requiresConfirmation: false,
          replyContext: 'INTENT_RESPONSE',
        };
      }

      case MessageIntent.SET_DEFAULT_CREDIT_CARD: {
        this.logger.log('✅ Delegando para CreditCardService.setDefaultCreditCard');
        const result = await this.creditCardService.setDefaultCreditCard(user, text);
        return {
          success: result.success,
          message: result.message,
          requiresConfirmation: false,
          replyContext: 'INTENT_RESPONSE',
        };
      }

      case MessageIntent.SHOW_DEFAULT_CREDIT_CARD: {
        this.logger.log('✅ Delegando para CreditCardService.showDefaultCreditCard');
        const result = await this.creditCardService.showDefaultCreditCard(user);
        return {
          success: result.success,
          message: result.message,
          requiresConfirmation: false,
          replyContext: 'INTENT_RESPONSE',
        };
      }

      case MessageIntent.SHOW_INVOICE_BY_CARD_NAME: {
        this.logger.log('✅ Delegando para CreditCardService.showInvoiceByCardName');
        const result = await this.creditCardService.showInvoiceByCardName(user, text);
        return {
          success: result.success,
          message: result.message,
          requiresConfirmation: false,
          replyContext: 'INTENT_RESPONSE',
        };
      }

      case MessageIntent.LIST_INVOICES: {
        this.logger.log('✅ Delegando para CreditCardService.listInvoices');
        const result = await this.creditCardService.listInvoices(user);
        return {
          success: result.success,
          message: result.message,
          requiresConfirmation: false,
          replyContext: 'INTENT_RESPONSE',
        };
      }

      case MessageIntent.SHOW_INVOICE_DETAILS: {
        const invoiceNumber = this.extractInvoiceNumber(text);
        if (!invoiceNumber) {
          this.logger.log('⚠️ Número da fatura não encontrado no texto');
          return {
            success: false,
            message:
              '💡 Para ver detalhes de uma fatura, primeiro liste as faturas com:\n' +
              '*"minhas faturas"*\n\n' +
              'Depois use: *"ver fatura 1"* (substituindo 1 pelo número da fatura)',
            requiresConfirmation: false,
            replyContext: 'INTENT_RESPONSE',
          };
        }
        this.logger.log(`✅ Delegando para CreditCardService.showInvoiceDetails (#${invoiceNumber})`);
        const detailsResult = await this.creditCardService.showInvoiceDetails(user, invoiceNumber);
        return {
          success: detailsResult.success,
          message: detailsResult.message,
          requiresConfirmation: false,
          replyContext: 'INTENT_RESPONSE',
        };
      }

      case MessageIntent.PAY_INVOICE: {
        const payInvoiceNumber = this.extractInvoiceNumber(text);
        if (!payInvoiceNumber) {
          this.logger.log('⚠️ Número da fatura não encontrado no texto');
          return {
            success: false,
            message:
              '💡 Para pagar uma fatura, primeiro liste as faturas com:\n' +
              '*"minhas faturas"*\n\n' +
              'Depois use: *"pagar fatura 1"* (substituindo 1 pelo número da fatura)',
            requiresConfirmation: false,
            replyContext: 'INTENT_RESPONSE',
          };
        }
        this.logger.log(`✅ Delegando para CreditCardService.payInvoice (#${payInvoiceNumber})`);
        const payResult = await this.creditCardService.payInvoice(user, payInvoiceNumber);
        return {
          success: payResult.success,
          message: payResult.message,
          requiresConfirmation: false,
          replyContext: 'INTENT_RESPONSE',
        };
      }

      default:
        return {
          success: false,
          message: '❌ Intenção de cartão de crédito não reconhecida.',
          requiresConfirmation: false,
          replyContext: 'ERROR',
        };
    }
  }

  /**
   * Extrai número da fatura do texto
   * Ex: "ver fatura 1" → 1, "pagar fatura 3" → 3, "fatura 2" → 2
   */
  private extractInvoiceNumber(text: string): number | null {
    // Padrão: "fatura N", "invoice N", "fatura #N"
    const match = text.match(/(?:fatura|invoice)\s*#?\s*(\d+)/i);
    if (match) {
      const num = parseInt(match[1]);
      if (num >= 1 && num <= 50) return num;
    }
    // Fallback: último número na mensagem (ex: "ver 1", "pagar 2")
    const numbers = text.match(/\d+/g);
    if (numbers && numbers.length === 1) {
      const num = parseInt(numbers[0]);
      if (num >= 1 && num <= 50) return num;
    }
    return null;
  }
}
