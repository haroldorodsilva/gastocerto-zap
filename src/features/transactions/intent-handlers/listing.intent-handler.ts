import { Injectable, Logger } from '@nestjs/common';
import { MessageIntent } from '@features/intent/intent-analyzer.service';
import { TransactionListingService, ListingFilters } from '../contexts/listing/listing.service';
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
    const { intentResult } = ctx;
    const monthReference = intentResult.metadata?.monthReference as string | undefined;
    const limit = intentResult.metadata?.limit as number | undefined;

    // Construir filtros baseado no que foi extraído da mensagem
    const filters: ListingFilters = {
      limit: limit || 100,
    };

    if (monthReference) {
      // Mês específico: converter YYYY-MM para startDate/endDate
      const [year, month] = monthReference.split('-').map(Number);
      const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
      const lastDay = new Date(year, month, 0).getDate();
      const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      filters.period = 'custom';
      filters.startDate = startDate;
      filters.endDate = endDate;
      this.logger.log(
        `✅ Listando transações de ${startDate} a ${endDate} (limit: ${filters.limit})`,
      );
    } else {
      filters.period = 'month';
      this.logger.log(
        `✅ Listando transações do mês atual (limit: ${filters.limit})`,
      );
    }

    const result = await this.listingService.listTransactions(ctx.user, filters);
    return {
      success: result.success,
      message: result.message,
      requiresConfirmation: false,
      replyContext: 'INTENT_RESPONSE',
    };
  }
}
