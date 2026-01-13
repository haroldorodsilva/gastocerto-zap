import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AdminController } from './admin.controller';
import { RagAdminController } from '../admin-controllers/controllers/rag-admin.controller';
import { UserCacheService } from '../users/user-cache.service';
import { GastoCertoApiService } from '@shared/gasto-certo-api.service';
import { PrismaService } from '@core/database/prisma.service';
import { ServiceAuthService } from '@common/services/service-auth.service';
import { JwtValidationService } from '@common/services/jwt-validation.service';
import { AIConfigService } from '../../infrastructure/ai/ai-config.service';
import { WhatsAppModule } from '@infrastructure/whatsapp/whatsapp.module';
import { TelegramModule } from '../../infrastructure/telegram/telegram.module';
import { RAGModule } from '@infrastructure/rag/rag.module';

@Module({
  imports: [
    HttpModule,
    WhatsAppModule, // Importa serviços de sessão WhatsApp
    TelegramModule, // Importa serviços de sessão Telegram
    RAGModule, // Importa serviços RAG
  ],
  controllers: [AdminController, RagAdminController],
  providers: [
    UserCacheService,
    GastoCertoApiService,
    ServiceAuthService,
    JwtValidationService,
    AIConfigService,
    PrismaService,
  ],
})
export class AdminModule {}
