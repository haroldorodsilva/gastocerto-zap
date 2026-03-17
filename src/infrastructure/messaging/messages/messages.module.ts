import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { MessageFilterService } from './message-filter.service';
import { MessagesProcessor } from './messages.processor';
import { TelegramMessagesProcessor } from './telegram-messages.processor';
import { TelegramMessageHandler } from './handlers/telegram-message.handler';
import { WhatsAppMessageHandler } from './handlers/whatsapp-message.handler';
import { MessageResponseService } from './message-response.service';
import { MessageContextService } from './message-context.service';
import { PlatformReplyService } from './platform-reply.service';
import { MessageValidationService } from '@features/messages/message-validation.service';
import { UsersModule } from '@features/users/users.module';
import { OnboardingModule } from '@features/onboarding/onboarding.module';
import { TransactionsModule } from '@features/transactions/transactions.module';
import { SessionsModule } from '@infrastructure/sessions/sessions.module';
import { WhatsAppModule } from '@infrastructure/whatsapp/whatsapp.module';

@Module({
  imports: [
    BullModule.registerQueue(
      {
        name: 'whatsapp-messages',
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: true,
          removeOnFail: false,
        },
      },
      {
        name: 'transaction-confirmation',
      },
      {
        name: 'telegram-messages',
        defaultJobOptions: {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2000,
          },
          removeOnComplete: true,
          removeOnFail: false,
        },
      },
    ),
    WhatsAppModule,
    UsersModule,
    forwardRef(() => OnboardingModule),
    forwardRef(() => TransactionsModule),
    SessionsModule,
  ],
  providers: [
    MessageFilterService,
    MessagesProcessor,
    TelegramMessagesProcessor,
    TelegramMessageHandler,
    WhatsAppMessageHandler,
    MessageResponseService,
    MessageContextService,
    MessageValidationService,
    PlatformReplyService,
  ],
  exports: [
    MessageFilterService,
    MessageResponseService,
    MessageContextService,
    MessageValidationService,
    PlatformReplyService,
  ],
})
export class MessagesModule {}
