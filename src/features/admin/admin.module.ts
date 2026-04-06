import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AdminController } from './admin.controller';
import { AdminUsersController } from './controllers/admin-users.controller';
import { AdminAIConfigController } from './controllers/admin-ai-config.controller';
import { AdminRagController } from './controllers/admin-rag.controller';
import { AdminSynonymsController } from './controllers/admin-synonyms.controller';
import { AdminOnboardingController } from './controllers/admin-onboarding.controller';
import { AdminMessagesController } from './controllers/admin-messages.controller';
import { WhatsAppModule } from '@infrastructure/whatsapp/whatsapp.module';
import { TelegramModule } from '../../infrastructure/telegram/telegram.module';
import { RAGModule } from '@infrastructure/rag/rag.module';
import { UsersModule } from '../users/users.module';
import { AiModule } from '../../infrastructure/ai/ai.module';
import { SharedModule } from '@shared/shared.module';

@Module({
  imports: [
    HttpModule,
    WhatsAppModule,
    TelegramModule,
    RAGModule,
    UsersModule,
    AiModule,
    SharedModule,
  ],
  controllers: [
    AdminController,
    AdminUsersController,
    AdminAIConfigController,
    AdminRagController,
    AdminSynonymsController,
    AdminOnboardingController,
    AdminMessagesController,
  ],
  providers: [],
})
export class AdminModule {}
