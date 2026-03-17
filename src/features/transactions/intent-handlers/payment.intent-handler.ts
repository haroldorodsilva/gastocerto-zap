import { Injectable, Logger } from '@nestjs/common';
import { MessageIntent } from '@features/intent/intent-analyzer.service';
import { TransactionPaymentService } from '../contexts/payment/payment.service';
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
        this.logger.log('✅ Delegando para TransactionPaymentService.processPayment');
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

      default:
        return {
          success: false,
          message: '❌ Intenção de pagamento não reconhecida.',
          requiresConfirmation: false,
          replyContext: 'ERROR',
        };
    }
  }
}
