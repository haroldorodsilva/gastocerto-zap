import { Injectable, Logger } from '@nestjs/common';
import { MessageIntent } from '@features/intent/intent-analyzer.service';
import { AccountManagementService } from '@features/accounts/account-management.service';
import { IntentHandler, IntentHandlerContext } from './intent-handler.interface';
import { ProcessMessageResult } from '../transactions.types';

/**
 * Handler para intents de gerenciamento de contas
 *
 * Intents: LIST_ACCOUNTS, SHOW_ACTIVE_ACCOUNT, SWITCH_ACCOUNT
 * Delega para: AccountManagementService
 */
@Injectable()
export class AccountIntentHandler implements IntentHandler {
  private readonly logger = new Logger(AccountIntentHandler.name);

  readonly supportedIntents = [
    MessageIntent.LIST_ACCOUNTS,
    MessageIntent.SHOW_ACTIVE_ACCOUNT,
    MessageIntent.SWITCH_ACCOUNT,
  ];

  constructor(private readonly accountManagement: AccountManagementService) {}

  async handle(ctx: IntentHandlerContext): Promise<ProcessMessageResult> {
    const { text, intentResult } = ctx;
    const phoneNumber = ctx.user.phoneNumber;

    switch (intentResult.intent) {
      case MessageIntent.LIST_ACCOUNTS: {
        this.logger.log('✅ Delegando para AccountManagementService.listUserAccounts');
        const result = await this.accountManagement.listUserAccounts(phoneNumber);
        return {
          success: result.success,
          message: result.message,
          requiresConfirmation: false,
          replyContext: 'INTENT_RESPONSE',
        };
      }

      case MessageIntent.SHOW_ACTIVE_ACCOUNT: {
        this.logger.log('✅ Delegando para AccountManagementService.showActiveAccount');
        const result = await this.accountManagement.showActiveAccount(phoneNumber);
        return {
          success: result.success,
          message: result.message,
          requiresConfirmation: false,
          replyContext: 'INTENT_RESPONSE',
        };
      }

      case MessageIntent.SWITCH_ACCOUNT: {
        this.logger.log('✅ Delegando para AccountManagementService.switchAccount');
        const result = await this.accountManagement.switchAccount(phoneNumber, text);
        return {
          success: result.success,
          message: result.message,
          requiresConfirmation: result.requiresConfirmation || false,
          replyContext: 'INTENT_RESPONSE',
        };
      }

      default:
        return {
          success: false,
          message: '❌ Intenção de conta não reconhecida.',
          requiresConfirmation: false,
          replyContext: 'ERROR',
        };
    }
  }
}
