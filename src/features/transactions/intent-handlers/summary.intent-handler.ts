import { Injectable, Logger } from '@nestjs/common';
import { MessageIntent } from '@features/intent/intent-analyzer.service';
import { TransactionSummaryService } from '../contexts/summary/summary.service';
import { IntentHandler, IntentHandlerContext } from './intent-handler.interface';
import { ProcessMessageResult } from '../transactions.types';

/**
 * Handler para intents de resumo/saldo
 *
 * Intents: CHECK_BALANCE
 * Delega para: TransactionSummaryService
 */
@Injectable()
export class SummaryIntentHandler implements IntentHandler {
  private readonly logger = new Logger(SummaryIntentHandler.name);

  readonly supportedIntents = [MessageIntent.CHECK_BALANCE];

  constructor(
    private readonly summaryService: TransactionSummaryService,
  ) {}

  async handle(ctx: IntentHandlerContext): Promise<ProcessMessageResult> {
    this.logger.log(
      '✅ Delegando para TransactionSummaryService.generateBalanceSummary',
    );
    const result = await this.summaryService.generateSummary(ctx.user, {
      summaryType: 'balance',
    });
    return {
      success: result.success,
      message: result.message,
      requiresConfirmation: false,
      replyContext: 'INTENT_RESPONSE',
    };
  }
}
