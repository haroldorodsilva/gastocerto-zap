import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WhatsAppController } from './whatsapp.controller';
import { SessionsService } from '../sessions.service';
import { SessionManagerService } from '../session-manager.service';
import { WhatsAppSessionManager } from '../whatsapp-session-manager.service';
import { WhatsAppGateway } from './whatsapp.gateway';
import { WhatsAppChatCacheService } from '../whatsapp-chat-cache.service';
import { PrismaService } from '@core/database/prisma.service';
import { WhatsAppIntegrationService } from '../../whatsapp-integration.service';

/**
 * Módulo WhatsApp - INTEGRADO COM BAILEYS SIMPLES
 *
 * Funcionalidades disponíveis:
 * - ✅ CRUD de sessões no banco de dados
 * - ✅ Endpoints REST para gerenciamento
 * - ✅ WebSocket gateway
 * - ✅ Integração com Baileys (simples e direto)
 * - ✅ Auto-restore de sessões
 * - ✅ QR code generation
 * - ✅ Recebimento e processamento de mensagens
 * - ✅ Envio de mensagens
 * - ✅ Cache de chats e mensagens no Redis (4h TTL)
 */
@Module({
  imports: [ConfigModule],
  controllers: [WhatsAppController],
  providers: [
    PrismaService,
    SessionsService,
    SessionManagerService,
    WhatsAppSessionManager,
    WhatsAppGateway,
    WhatsAppIntegrationService,
    WhatsAppChatCacheService,
  ],
  exports: [
    SessionsService,
    SessionManagerService,
    WhatsAppSessionManager,
    WhatsAppIntegrationService,
    WhatsAppChatCacheService,
  ],
})
export class WhatsAppModule {}
