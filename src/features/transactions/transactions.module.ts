import { Module, forwardRef } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TransactionsService } from './transactions.service';
import { TransactionConfirmationService } from './transaction-confirmation.service';
import { TransactionValidatorService } from './transaction-validator.service';
import { ConfirmationExpirationJob } from './confirmation-expiration.job';
import { ApiRetryJob } from './api-retry.job';
import { TransactionRegistrationService } from './contexts/registration/registration.service';
import { TransactionApiSenderService } from './contexts/registration/transaction-api-sender.service';
import { TransactionMessageFormatterService } from './contexts/registration/transaction-message-formatter.service';
import { TransactionListingService } from './contexts/listing/listing.service';
import { TransactionPaymentService } from './contexts/payment/payment.service';
import { TransactionSummaryService } from './contexts/summary/summary.service';
import { MessageLearningService } from './message-learning.service';
import { ListContextService } from './list-context.service';
import { CreditCardService } from '../credit-cards/credit-card.service';
import { TransactionsController } from './transactions.controller';
import { DiscordNotificationService } from '@common/services/discord-notification.service';
import { TemporalParserService } from '@features/transactions/services/parsers/temporal-parser.service';
import { InstallmentParserService } from '@features/transactions/services/parsers/installment-parser.service';
import { FixedTransactionParserService } from '@features/transactions/services/parsers/fixed-transaction-parser.service';
import { CreditCardParserService } from '@features/transactions/services/parsers/credit-card-parser.service';
import { CreditCardInvoiceCalculatorService } from '@features/transactions/services/parsers/credit-card-invoice-calculator.service';
import { PaymentStatusResolverService } from './services/payment-status-resolver.service';
import { RecurringTransactionService } from './services/recurring-transaction.service';
import { CategoryResolverService } from './services/category-resolver.service';
import { AiModule } from '../../infrastructure/ai/ai.module';
import { RAGModule } from '@infrastructure/rag/rag.module';
import { UsersModule } from '@features/users/users.module';
import { IntentModule } from '@features/intent/intent.module';
import { AccountsModule } from '@features/accounts/accounts.module';
import { MessagesModule } from '@infrastructure/messaging/messages/messages.module';
import { SecurityModule } from '@features/security/security.module';
import { ConversationModule } from '@features/conversation/conversation.module';
// Intent Handlers (Strategy Pattern)
import {
  INTENT_HANDLERS,
  AccountIntentHandler,
  ChartIntentHandler,
  ConfirmationIntentHandler,
  PaymentIntentHandler,
  SummaryIntentHandler,
  CreditCardIntentHandler,
  ListingIntentHandler,
  RegistrationIntentHandler,
} from './intent-handlers';

/** Todas as classes de IntentHandler para injeção via factory */
const INTENT_HANDLER_CLASSES = [
  AccountIntentHandler,
  ChartIntentHandler,
  ConfirmationIntentHandler,
  PaymentIntentHandler,
  SummaryIntentHandler,
  CreditCardIntentHandler,
  ListingIntentHandler,
  RegistrationIntentHandler,
];

@Module({
  imports: [
    HttpModule,
    AiModule,
    RAGModule,
    UsersModule,
    IntentModule,
    AccountsModule,
    SecurityModule,
    ConversationModule,
    forwardRef(() => MessagesModule),
  ],
  controllers: [TransactionsController],
  providers: [
    TransactionsService,
    TransactionConfirmationService,
    TransactionValidatorService,
    ConfirmationExpirationJob,
    ApiRetryJob,
    DiscordNotificationService,
    // Context Services
    TransactionRegistrationService,
    TransactionApiSenderService,
    TransactionMessageFormatterService,
    TransactionListingService,
    TransactionPaymentService,
    TransactionSummaryService,
    MessageLearningService, // ✅ Serviço de aprendizado inteligente
    CreditCardService, // ✅ Serviço de cartões de crédito
    ListContextService, // ✅ Serviço de contexto de lista
    // Intent Handlers (Strategy Pattern)
    ...INTENT_HANDLER_CLASSES,
    {
      provide: INTENT_HANDLERS,
      useFactory: (...handlers) => handlers,
      inject: INTENT_HANDLER_CLASSES,
    },
    // Serviços NLP para transações avançadas
    TemporalParserService,
    InstallmentParserService,
    FixedTransactionParserService,
    CreditCardParserService,
    CreditCardInvoiceCalculatorService,
    PaymentStatusResolverService,
    RecurringTransactionService,
    CategoryResolverService,
  ],
  exports: [
    TransactionsService,
    TransactionConfirmationService,
    TransactionValidatorService,
    TransactionRegistrationService,
    TransactionListingService,
    TransactionPaymentService,
    TransactionSummaryService,
    MessageLearningService, // ✅ Exportar para uso nos handlers
  ],
})
export class TransactionsModule {}
