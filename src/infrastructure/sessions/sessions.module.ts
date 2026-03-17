import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ExternalController } from './external.controller';
import { WhatsAppModule } from '@infrastructure/whatsapp/whatsapp.module';
import { TelegramModule } from '@infrastructure/telegram/telegram.module';
import { MultiPlatformSessionModule } from './multi-platform-session.module';
import { SessionsService } from './core/sessions.service';
import { SessionManagerService } from './core/session-manager.service';
import { SessionHealthMonitorService } from './core/session-health-monitor.service';
import { UsersModule } from '@features/users/users.module';

/**
 * Módulo Sessions - GENÉRICO
 *
 * Coordena funcionalidades de sessão independentes de plataforma.
 * Mantém controladores e serviços genéricos (external, multi-platform).
 * 
 * Este módulo não deve conter código específico de WhatsApp ou Telegram.
 */
@Module({
  imports: [ConfigModule, MultiPlatformSessionModule, WhatsAppModule, TelegramModule, UsersModule],
  controllers: [ExternalController],
  providers: [SessionsService, SessionManagerService, SessionHealthMonitorService],
  exports: [SessionsService, SessionManagerService, MultiPlatformSessionModule, SessionHealthMonitorService],
})
export class SessionsModule {}
