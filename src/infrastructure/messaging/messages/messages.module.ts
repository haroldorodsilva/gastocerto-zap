import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { MessageFilterService } from './message-filter.service';
import { MessagesProcessor } from './messages.processor';
import { TelegramMessageHandler } from './handlers/telegram-message.handler';
import { WhatsAppMessageHandler } from './handlers/whatsapp-message.handler';
import { MessageResponseService } from './message-response.service';
import { MessageContextService } from './message-context.service';
import { MessageValidationService } from '@features/messages/message-validation.service';
import { UsersModule } from '@features/users/users.module';
import { OnboardingModule } from '@features/onboarding/onboarding.module';
import { TransactionsModule } from '@features/transactions/transactions.module';
import { SessionsModule } from '@infrastructure/sessions/sessions.module';
import { PrismaService } from '@core/database/prisma.service';
import { MultiPlatformSessionModule } from '@infrastructure/messaging/multi-platform-session.module';
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
    ),
    MultiPlatformSessionModule,
    WhatsAppModule,
    UsersModule,
    forwardRef(() => OnboardingModule),
    forwardRef(() => TransactionsModule),
    SessionsModule,
  ],
  providers: [
    PrismaService,
    MessageFilterService,
    MessagesProcessor,
    TelegramMessageHandler,
    WhatsAppMessageHandler,
    MessageResponseService,
    MessageContextService,
    MessageValidationService,
  ],
  exports: [
    MessageFilterService,
    MessageResponseService,
    MessageContextService,
    MessageValidationService,
  ],
})
export class MessagesModule {}
