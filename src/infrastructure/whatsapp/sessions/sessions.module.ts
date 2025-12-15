import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ExternalController } from './external.controller';
import { WhatsAppModule } from './whatsapp/whatsapp.module';
import { TelegramModule } from './telegram/telegram.module';
import { MultiPlatformSessionModule } from './multi-platform-session.module';
import { SessionsService } from './sessions.service';
import { SessionManagerService } from './session-manager.service';
import { PrismaService } from '@core/database/prisma.service';
import { UsersModule } from '../../../features/users/users.module';

/**
 * Módulo Sessions
 * 
 * Módulo principal que coordena os submódulos de WhatsApp e Telegram.
 * Mantém controladores e serviços genéricos (external, multi-platform).
 * SessionsController removido - gerenciamento agora é feito pelos controllers específicos.
 * 
 * NOTA: MultiPlatformSessionService agora vem do MultiPlatformSessionModule @Global
 */
@Module({
  imports: [
    ConfigModule,
    MultiPlatformSessionModule,
    WhatsAppModule,
    TelegramModule,
    UsersModule,
  ],
  controllers: [ExternalController],
  providers: [
    PrismaService,
    SessionsService,
    SessionManagerService,
  ],
  exports: [
    SessionsService,
    SessionManagerService,
    WhatsAppModule,
    TelegramModule,
  ],
})
export class SessionsModule {}
