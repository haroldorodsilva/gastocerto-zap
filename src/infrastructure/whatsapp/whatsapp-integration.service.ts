import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '@core/database/prisma.service';
import * as path from 'path';
import * as fs from 'fs';
import { WASocket } from '@whiskeysockets/baileys';
import {
  initializeSimpleWhatsApp,
  setupWhatsAppIntegration,
  sendWhatsAppMessage,
  stopWhatsAppConnection,
} from './simple-whatsapp-init';

/**
 * Serviço de integração do WhatsApp simples com o sistema existente
 * Conecta o Baileys com os handlers de mensagem e banco de dados
 */
@Injectable()
export class WhatsAppIntegrationService implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppIntegrationService.name);

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    this.logger.log('🔌 Configurando integração do WhatsApp...');

    // Configurar handler que vai processar as mensagens
    const messageHandler = {
      handleIncomingMessage: async (payload: { sessionId: string; message: any }) => {
        // Emitir evento para o sistema existente processar
        this.eventEmitter.emit('whatsapp.message', payload);
        this.logger.debug(
          `📤 Evento 'whatsapp.message' emitido para ${payload.message.key.remoteJid}`,
        );
      },
    };

    // Configurar integração
    setupWhatsAppIntegration(messageHandler, this.prisma, this.eventEmitter);

    // ⚠️ AUTO-RESTORE DESABILITADO - Use WhatsAppSessionManager via API
    // await this.autoRestoreSession();

    this.logger.log('✅ Integração do WhatsApp configurada (auto-restore DESABILITADO)');
    this.logger.warn('💡 Use WhatsAppSessionManager via API para gerenciar sessões');
  }

  /**
   * Auto-restore: Reconecta sessão ativa se existirem credenciais
   */
  private async autoRestoreSession() {
    try {
      const session = await this.prisma.whatsAppSession.findUnique({
        where: { sessionId: 'whatsapp-simple-session' },
      });

      if (!session) {
        this.logger.log('ℹ️  Nenhuma sessão cadastrada');
        return;
      }

      if (!session.isActive) {
        this.logger.log('⏸️  Sessão existe mas está desativada - não reconectando');
        return;
      }

      // Verificar se existem credenciais
      const credsPath = path.join(process.cwd(), '.auth_info', 'creds.json');
      if (!fs.existsSync(credsPath)) {
        this.logger.log('🔑 Sessão ativa mas sem credenciais - aguardando QR Code');
        return;
      }

      this.logger.log('🔄 Sessão ativa encontrada com credenciais - reconectando...');
      await initializeSimpleWhatsApp();
      this.logger.log('✅ Sessão restaurada com sucesso');
    } catch (error) {
      this.logger.error('❌ Erro ao restaurar sessão:', error.message);
    }
  }

  /**
   * Inicializa o WhatsApp (chamado pela API de administração)
   * @param skipActiveCheck - Se true, não verifica isActive no banco (usado durante ativação manual)
   */
  async initializeWhatsApp(skipActiveCheck = false): Promise<WASocket> {
    this.logger.log('🚀 Inicializando WhatsApp sob demanda...');
    return await initializeSimpleWhatsApp(skipActiveCheck);
  }

  /**
   * Para a conexão do WhatsApp
   */
  async stopWhatsApp(): Promise<void> {
    this.logger.log('🛑 Parando conexão do WhatsApp...');
    await stopWhatsAppConnection();
    this.logger.log('✅ Conexão encerrada');
  }

  /**
   * Envia mensagem via WhatsApp
   */
  async sendMessage(to: string, text: string): Promise<boolean> {
    return sendWhatsAppMessage(to, text);
  }
}
