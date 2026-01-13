import { Module, forwardRef } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { OnboardingStateService } from './onboarding-state.service';
import { EmailValidator } from './validators/email.validator';
import { NameValidator } from './validators/name.validator';
import { PhoneValidator } from './validators/phone.validator';
import { UsersModule } from '@features/users/users.module';
import { PrismaService } from '@core/database/prisma.service';
import { MessagesModule } from '@infrastructure/messaging/messages/messages.module';

@Module({
  imports: [
    UsersModule,
    forwardRef(() => MessagesModule),
  ],
  providers: [
    OnboardingService,
    OnboardingStateService,
    EmailValidator,
    NameValidator,
    PhoneValidator,
    PrismaService,
  ],
  exports: [OnboardingService, OnboardingStateService],
})
export class OnboardingModule {}
