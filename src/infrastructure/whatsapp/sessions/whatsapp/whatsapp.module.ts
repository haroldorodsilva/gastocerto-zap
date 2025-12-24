import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { WhatsAppController } from './whatsapp.controller';
import { SessionsService } from '../sessions.service';
import { SessionManagerService } from '../session-manager.service';
import { DatabaseAuthStateManager } from './database-auth-state.manager';
import { BaileysWhatsAppProvider } from './baileys-whatsapp.provider';
import { BaileysProviderFactory } from './baileys-provider.factory';
import { WhatsAppGateway } from './whatsapp.gateway';
import { PrismaService } from '@core/database/prisma.service';

/**
 * Módulo WhatsApp
 *
 * Gerencia todas as funcionalidades do WhatsApp:
 * - Sessões e conexões via Baileys
 * - Auth state management com banco de dados
 * - WebSocket gateway para eventos em tempo real
 * - Envio de mensagens
 */
@Module({
  imports: [ConfigModule, EventEmitterModule],
  controllers: [WhatsAppController],
  providers: [
    PrismaService,
    SessionsService,
    SessionManagerService,
    DatabaseAuthStateManager,
    // BaileysWhatsAppProvider NÃO é provider direto - criado via factory
    BaileysProviderFactory,
    WhatsAppGateway,
  ],
  exports: [
    SessionsService,
    SessionManagerService,
    DatabaseAuthStateManager,
    // BaileysWhatsAppProvider NÃO exportado - use BaileysProviderFactory
    BaileysProviderFactory,
  ],
})
export class WhatsAppModule {}
