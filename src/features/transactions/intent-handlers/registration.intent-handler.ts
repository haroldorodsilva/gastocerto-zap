import { Injectable, Logger } from '@nestjs/common';
import { MessageIntent } from '@features/intent/intent-analyzer.service';
import { TransactionRegistrationService } from '../contexts/registration/registration.service';
import { IntentHandler, IntentHandlerContext } from './intent-handler.interface';
import { ProcessMessageResult } from '../transactions.types';

/**
 * Handler para intents de registro de transação (texto)
 *
 * Intents: REGISTER_TRANSACTION
 * Delega para: TransactionRegistrationService
 *
 * Também atua como fallback quando nenhum outro handler mapeia o intent.
 */
@Injectable()
export class RegistrationIntentHandler implements IntentHandler {
  private readonly logger = new Logger(RegistrationIntentHandler.name);

  readonly supportedIntents = [MessageIntent.REGISTER_TRANSACTION];

  constructor(
    private readonly registrationService: TransactionRegistrationService,
  ) {}

  async handle(ctx: IntentHandlerContext): Promise<ProcessMessageResult> {
    this.logger.log('✅ Delegando para TransactionRegistrationService');

    const activeAccountId = ctx.accountId || ctx.user.activeAccountId;

    const result = await this.registrationService.processTextTransaction(
      ctx.phoneNumber,
      ctx.text,
      ctx.messageId,
      ctx.user,
      ctx.platform,
      activeAccountId,
    );

    return {
      ...result,
      platform: ctx.platform,
      replyContext: result.requiresConfirmation
        ? 'CONFIRMATION_REQUEST'
        : 'TRANSACTION_RESULT',
    };
  }
}
