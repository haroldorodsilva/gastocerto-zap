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
        this.logger.log('✅ Delegando para CreditCardService.showInvoiceDetails');
        // TODO: Extrair número da fatura da mensagem (ex: "ver fatura 1")
        // Por ora, retornar mensagem pedindo número
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

      case MessageIntent.PAY_INVOICE: {
        this.logger.log('✅ Delegando para CreditCardService.payInvoice');
        // TODO: Extrair número da fatura da mensagem (ex: "pagar fatura 1")
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

      default:
        return {
          success: false,
          message: '❌ Intenção de cartão de crédito não reconhecida.',
          requiresConfirmation: false,
          replyContext: 'ERROR',
        };
    }
  }
}
