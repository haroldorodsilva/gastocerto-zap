import { Injectable, Logger } from '@nestjs/common';
import { MessageIntent } from '@features/intent/intent-analyzer.service';
import { TransactionListingService } from '../contexts/listing/listing.service';
import { IntentHandler, IntentHandlerContext } from './intent-handler.interface';
import { ProcessMessageResult } from '../transactions.types';

/**
 * Handler para intents de listagem de transações
 *
 * Intents: LIST_TRANSACTIONS
 * Delega para: TransactionListingService
 */
@Injectable()
export class ListingIntentHandler implements IntentHandler {
  private readonly logger = new Logger(ListingIntentHandler.name);

  readonly supportedIntents = [MessageIntent.LIST_TRANSACTIONS];

  constructor(
    private readonly listingService: TransactionListingService,
  ) {}

  async handle(ctx: IntentHandlerContext): Promise<ProcessMessageResult> {
    this.logger.log(
      '✅ Delegando para TransactionListingService.listTransactions',
    );
    const result = await this.listingService.listTransactions(ctx.user, {
      period: 'month', // Padrão: mês atual
      limit: 100, // TODO: Fazer paginação futura
    });
    return {
      success: result.success,
      message: result.message,
      requiresConfirmation: false,
      replyContext: 'INTENT_RESPONSE',
    };
  }
}
