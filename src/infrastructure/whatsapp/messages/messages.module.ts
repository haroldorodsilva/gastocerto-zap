import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { MessageFilterService } from './message-filter.service';
import { MessagesProcessor } from './messages.processor';
import { TelegramMessageHandler } from './telegram-message.handler';
import { WhatsAppMessageHandler } from './whatsapp-message.handler';
import { MessageResponseService } from './message-response.service';
import { MessageContextService } from './message-context.service';
import { MessageValidationService } from '@features/messages/message-validation.service';
import { UsersModule } from '@features/users/users.module';
import { OnboardingModule } from '@features/onboarding/onboarding.module';
import { TransactionsModule } from '@features/transactions/transactions.module';
import { SessionsModule } from '../sessions/sessions.module';
import { PrismaService } from '@core/database/prisma.service';

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
    UsersModule,
    OnboardingModule,
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
