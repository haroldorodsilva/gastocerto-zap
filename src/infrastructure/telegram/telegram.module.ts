import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TelegramController } from './controllers/telegram.controller';
import { TelegramSessionsService } from './providers/telegram-sessions.service';
import { TelegramProvider } from './providers/telegram.provider';
import { PrismaService } from '@core/database/prisma.service';

/**
 * Módulo Telegram
 *
 * Gerencia todas as funcionalidades do Telegram:
 * - Sessões e conexões
 * - Envio de mensagens
 * - Gerenciamento de estado
 *
 * NOTA: MultiPlatformSessionService está disponível via @Global() MultiPlatformSessionModule
 */
@Module({
  imports: [ConfigModule, EventEmitterModule],
  controllers: [TelegramController],
  providers: [PrismaService, TelegramSessionsService, TelegramProvider],
  exports: [TelegramSessionsService, TelegramProvider],
})
export class TelegramModule {}
