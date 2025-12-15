import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { AdminController } from './admin.controller';
import { UserCacheService } from '../users/user-cache.service';
import { GastoCertoApiService } from '@shared/gasto-certo-api.service';
import { PrismaService } from '@core/database/prisma.service';
import { ServiceAuthService } from '@common/services/service-auth.service';
import { JwtValidationService } from '@common/services/jwt-validation.service';
import { AIConfigService } from '../../infrastructure/ai/ai-config.service';
import { WhatsAppModule } from '../../infrastructure/whatsapp/sessions/whatsapp/whatsapp.module';
import { TelegramModule } from '../../infrastructure/whatsapp/sessions/telegram/telegram.module';
import { RAGService } from '../../infrastructure/ai/rag/rag.service';

@Module({
  imports: [
    HttpModule,
    WhatsAppModule, // Importa serviços de sessão WhatsApp
    TelegramModule, // Importa serviços de sessão Telegram
  ],
  controllers: [AdminController],
  providers: [
    UserCacheService,
    GastoCertoApiService,
    ServiceAuthService,
    JwtValidationService,
    AIConfigService,
    PrismaService,
    RAGService,
  ],
})
export class AdminModule {}
