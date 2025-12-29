import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WhatsAppController } from './whatsapp.controller';
import { SessionsService } from '../sessions.service';
import { SessionManagerService } from '../session-manager.service';
import { WhatsAppSessionManager } from '../whatsapp-session-manager.service';
import { WhatsAppGateway } from './whatsapp.gateway';
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
  ],
  exports: [
    SessionsService,
    SessionManagerService,
    WhatsAppSessionManager,
    WhatsAppIntegrationService,
  ],
})
export class WhatsAppModule {}
