import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { HttpModule } from '@nestjs/axios';
import { TransactionsService } from './transactions.service';
import { TransactionConfirmationService } from './transaction-confirmation.service';
import { TransactionValidatorService } from './transaction-validator.service';
import { ConfirmationExpirationJob } from './confirmation-expiration.job';
import { ApiRetryJob } from './api-retry.job';
import { AIProcessingProcessor } from './processors/ai-processing.processor';
import { TransactionConfirmationProcessor } from './processors/transaction-confirmation.processor';
import { TransactionRegistrationProcessor } from './processors/transaction-registration.processor';
import { TransactionRegistrationService } from './contexts/registration/registration.service';
import { TransactionListingService } from './contexts/listing/listing.service';
import { TransactionPaymentService } from './contexts/payment/payment.service';
import { TransactionSummaryService } from './contexts/summary/summary.service';
import { TransactionsController } from './transactions.controller';
import { DiscordNotificationService } from '@common/services/discord-notification.service';
import { AiModule } from '../../infrastructure/ai/ai.module';
import { RAGModule } from '../../infrastructure/ai/rag/rag.module';
import { UsersModule } from '@features/users/users.module';
import { IntentModule } from '@features/intent/intent.module';
import { AccountsModule } from '@features/accounts/accounts.module';
import { MessagesModule } from '../../infrastructure/whatsapp/messages/messages.module';
import { SecurityModule } from '@features/security/security.module';
import { PrismaService } from '@core/database/prisma.service';

@Module({
  imports: [
    HttpModule,
    AiModule,
    RAGModule,
    UsersModule,
    IntentModule,
    AccountsModule,
    SecurityModule,
    forwardRef(() => MessagesModule),
    BullModule.registerQueue(
      {
        name: 'ai-processing',
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
        defaultJobOptions: {
          attempts: 2,
          backoff: {
            type: 'fixed',
            delay: 1000,
          },
          removeOnComplete: true,
          removeOnFail: false,
        },
      },
      {
        name: 'transaction-registration',
        defaultJobOptions: {
          attempts: 5,
          backoff: {
            type: 'exponential',
            delay: 3000,
          },
          removeOnComplete: true,
          removeOnFail: false,
        },
      },
    ),
  ],
  controllers: [TransactionsController],
  providers: [
    TransactionsService,
    TransactionConfirmationService,
    TransactionValidatorService,
    ConfirmationExpirationJob,
    ApiRetryJob,
    DiscordNotificationService,
    AIProcessingProcessor,
    TransactionConfirmationProcessor,
    TransactionRegistrationProcessor,
    // Context Services
    TransactionRegistrationService,
    TransactionListingService,
    TransactionPaymentService,
    TransactionSummaryService,
    PrismaService,
  ],
  exports: [
    TransactionsService,
    TransactionConfirmationService,
    TransactionValidatorService,
    TransactionRegistrationService,
    TransactionListingService,
    TransactionPaymentService,
    TransactionSummaryService,
  ],
})
export class TransactionsModule {}
