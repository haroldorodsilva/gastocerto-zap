import { Injectable, Logger } from '@nestjs/common';
import { MessageIntent } from '@features/intent/intent-analyzer.service';
import { TransactionSummaryService } from '../contexts/summary/summary.service';
import { IntentHandler, IntentHandlerContext } from './intent-handler.interface';
import { ProcessMessageResult } from '../transactions.types';

/**
 * Handler para intents de resumo/saldo
 *
 * Intents: CHECK_BALANCE, MONTHLY_SUMMARY, CATEGORY_BREAKDOWN
 * Delega para: TransactionSummaryService
 */
@Injectable()
export class SummaryIntentHandler implements IntentHandler {
  private readonly logger = new Logger(SummaryIntentHandler.name);

  readonly supportedIntents = [
    MessageIntent.CHECK_BALANCE,
    MessageIntent.MONTHLY_SUMMARY,
    MessageIntent.CATEGORY_BREAKDOWN,
  ];

  constructor(
    private readonly summaryService: TransactionSummaryService,
  ) {}

  async handle(ctx: IntentHandlerContext): Promise<ProcessMessageResult> {
    const { intentResult } = ctx;
    const monthReference = intentResult.metadata?.monthReference;

    switch (intentResult.intent) {
      case MessageIntent.MONTHLY_SUMMARY: {
        this.logger.log(
          `✅ Delegando para TransactionSummaryService.generateSummary (monthly, month: ${monthReference || 'current'})`,
        );
        const result = await this.summaryService.generateSummary(ctx.user, {
          summaryType: 'monthly',
          monthReference,
        });
        return {
          success: result.success,
          message: result.message,
          requiresConfirmation: false,
          replyContext: 'INTENT_RESPONSE',
        };
      }

      case MessageIntent.CATEGORY_BREAKDOWN: {
        this.logger.log(
          `✅ Delegando para TransactionSummaryService.generateSummary (category_breakdown, month: ${monthReference || 'current'})`,
        );
        const result = await this.summaryService.generateSummary(ctx.user, {
          summaryType: 'category_breakdown',
          monthReference,
        });
        return {
          success: result.success,
          message: result.message,
          requiresConfirmation: false,
          replyContext: 'INTENT_RESPONSE',
        };
      }

      case MessageIntent.CHECK_BALANCE:
      default: {
        this.logger.log(
          '✅ Delegando para TransactionSummaryService.generateSummary (balance)',
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
  }
}
