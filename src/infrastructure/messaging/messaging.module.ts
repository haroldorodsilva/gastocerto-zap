import { Module } from '@nestjs/common';
import { MessagesModule } from './messages/messages.module';
import { GatewayModule } from './gateway/gateway.module';
import { MultiPlatformSessionService } from './core/services/multi-platform-session.service';
import { SessionsService } from './core/services/sessions.service';

/**
 * Módulo raiz para toda a infraestrutura de mensageria
 * Agrupa funcionalidades compartilhadas entre WhatsApp, Telegram e outras plataformas
 */
@Module({
  imports: [
    MessagesModule,
    GatewayModule,
  ],
  providers: [
    MultiPlatformSessionService,
    SessionsService,
  ],
  exports: [
    MessagesModule,
    GatewayModule,
    MultiPlatformSessionService,
    SessionsService,
  ],
})
export class MessagingModule {}
