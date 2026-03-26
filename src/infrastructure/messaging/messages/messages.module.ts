import { Module, forwardRef } from '@nestjs/common';
import { MessageFilterService } from './message-filter.service';
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
    WhatsAppModule,
    UsersModule,
    forwardRef(() => OnboardingModule),
    forwardRef(() => TransactionsModule),
    SessionsModule,
  ],
  providers: [
    MessageFilterService,
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
