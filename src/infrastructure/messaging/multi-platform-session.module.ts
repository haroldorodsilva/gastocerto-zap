import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MultiPlatformSessionService } from './core/services/multi-platform-session.service';
import { PrismaService } from '@core/database/prisma.service';

/**
 * Módulo Global para MultiPlatformSessionService
 *
 * Garante que existe apenas UMA instância do serviço em toda a aplicação,
 * evitando conflitos de múltiplos bots Telegram tentando fazer polling simultaneamente.
 *
 * @Global - Torna o módulo disponível em toda a aplicação sem necessidade de import
 */
@Global()
@Module({
  imports: [ConfigModule, EventEmitterModule],
  providers: [MultiPlatformSessionService],
  exports: [MultiPlatformSessionService],
})
export class MultiPlatformSessionModule {}
