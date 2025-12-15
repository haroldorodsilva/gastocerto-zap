import { Module } from '@nestjs/common';
import { AssistantService } from './assistant.service';
import { AssistantController } from './assistant.controller';
import { IntentAnalyzerService } from './intent/intent-analyzer.service';
import { SecurityModule } from '../security/security.module';
import { UsersModule } from '@features/users/users.module';
import { TransactionsModule } from '@features/transactions/transactions.module';
import { OnboardingModule } from '@features/onboarding/onboarding.module';
import { PrismaService } from '@core/database/prisma.service';

@Module({
  imports: [
    SecurityModule,
    UsersModule,
    TransactionsModule,
    OnboardingModule,
  ],
  controllers: [AssistantController],
  providers: [AssistantService, IntentAnalyzerService, PrismaService],
  exports: [AssistantService],
})
export class AssistantModule {}
