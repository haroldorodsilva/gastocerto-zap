import { Module } from '@nestjs/common';
import { MessagingModule } from './messaging/messaging.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';
import { TelegramModule } from './telegram/telegram.module';
import { SessionsModule } from './sessions/sessions.module';

/**
 * Módulo raiz da infraestrutura de mensageria
 *
 * Estrutura organizada:
 * - sessions/: Gestão genérica de sessões (multi-plataforma, CRUD, external API)
 * - messaging/: Código compartilhado entre plataformas (gateway, processadores, handlers)
 * - whatsapp/: Implementação específica do WhatsApp (Baileys)
 * - telegram/: Implementação específica do Telegram
 *
 * Facilita:
 * - Adição de novas plataformas (Discord, SMS, etc)
 * - Manutenção e testes isolados
 * - Reutilização de código
 */
@Module({
  imports: [SessionsModule, MessagingModule, WhatsAppModule, TelegramModule],
  exports: [SessionsModule, MessagingModule, WhatsAppModule, TelegramModule],
})
export class InfrastructureModule {}
