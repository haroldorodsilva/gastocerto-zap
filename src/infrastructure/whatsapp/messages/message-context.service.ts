import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { MessagingPlatform } from '@common/interfaces/messaging-provider.interface';

/**
 * Contexto de uma conversa ativa
 */
export interface MessageContext {
  /** ID da sessão ativa (telegram-xxx ou session-xxx) */
  sessionId: string;
  /** Plataforma de origem (telegram ou whatsapp) */
  platform: MessagingPlatform;
  /** userId (gastoCertoId) do usuário - para rastreabilidade */
  userId?: string;
  /** phoneNumber normalizado do usuário - para logs */
  phoneNumber?: string;
  /** Timestamp da última atividade */
  lastActivity: number;
  /** Timestamp de expiração */
  expiresAt: number;
}

/**
 * Serviço que mantém o contexto de conversas ativas
 *
 * Garante que mensagens sejam roteadas para a plataforma correta:
 * - Se mensagem veio do Telegram → resposta volta para Telegram
 * - Se mensagem veio do WhatsApp → resposta volta para WhatsApp
 *
 * O contexto é indexado por `platformId`:
 * - Telegram: chatId (ex: "707624962")
 * - WhatsApp: phoneNumber@s.whatsapp.net (ex: "5566996285154@s.whatsapp.net")
 */
@Injectable()
export class MessageContextService {
  private readonly logger = new Logger(MessageContextService.name);

  // Cache: platformId -> MessageContext
  private readonly contexts = new Map<string, MessageContext>();

  // TTL padrão: 1 hora
  private readonly DEFAULT_TTL = 60 * 60 * 1000;

  // Limpeza automática a cada 5 minutos
  private readonly cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Iniciar limpeza automática
    this.cleanupInterval = setInterval(
      () => {
        this.cleanExpiredContexts();
      },
      5 * 60 * 1000,
    );

    this.logger.log('✅ MessageContextService inicializado');
  }

  /**
   * Registra contexto de uma mensagem recebida
   *
   * @param platformId - ID da plataforma (chatId Telegram ou phoneNumber@s.whatsapp.net)
   * @param sessionId - ID da sessão ativa
   * @param platform - Plataforma de origem (whatsapp ou telegram)
   * @param userId - gastoCertoId do usuário (opcional, para rastreabilidade)
   * @param phoneNumber - Telefone normalizado (opcional, para logs)
   */
  registerContext(
    platformId: string,
    sessionId: string,
    platform: MessagingPlatform,
    userId?: string,
    phoneNumber?: string,
  ): void {
    const now = Date.now();
    const context: MessageContext = {
      sessionId,
      platform,
      userId,
      phoneNumber,
      lastActivity: now,
      expiresAt: now + this.DEFAULT_TTL,
    };

    this.contexts.set(platformId, context);

    this.logger.debug(
      `📝 Contexto registrado: ${platformId} → [${platform}] ${sessionId}` +
        (userId ? ` | userId: ${userId}` : '') +
        (phoneNumber ? ` | phone: ${phoneNumber}` : '') +
        ` (expires: ${new Date(context.expiresAt).toISOString()})`,
    );
  }

  /**
   * Obtém contexto de uma conversa ativa
   *
   * @returns MessageContext se encontrado e válido, null caso contrário
   */
  getContext(platformId: string): MessageContext | null {
    const context = this.contexts.get(platformId);

    if (!context) {
      this.logger.debug(`❌ Contexto não encontrado: ${platformId}`);
      return null;
    }

    // Verificar se expirou
    if (context.expiresAt < Date.now()) {
      this.logger.debug(`⏰ Contexto expirado: ${platformId}`);
      this.contexts.delete(platformId);
      return null;
    }

    // Atualizar lastActivity
    context.lastActivity = Date.now();

    this.logger.debug(
      `✅ Contexto encontrado: ${platformId} → [${context.platform}] ${context.sessionId}`,
    );

    return context;
  }

  /**
   * Atualiza TTL de um contexto (renova expiração)
   */
  renewContext(platformId: string, ttl?: number): boolean {
    const context = this.contexts.get(platformId);

    if (!context) {
      return false;
    }

    const now = Date.now();
    context.lastActivity = now;
    context.expiresAt = now + (ttl || this.DEFAULT_TTL);

    this.logger.debug(
      `🔄 Contexto renovado: ${platformId} (expires: ${new Date(context.expiresAt).toISOString()})`,
    );

    return true;
  }

  /**
   * Remove contexto manualmente
   */
  removeContext(platformId: string): boolean {
    const deleted = this.contexts.delete(platformId);

    if (deleted) {
      this.logger.debug(`🗑️  Contexto removido: ${platformId}`);
    }

    return deleted;
  }

  /**
   * Limpa contextos expirados automaticamente
   */
  private cleanExpiredContexts(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [platformId, context] of this.contexts.entries()) {
      if (context.expiresAt < now) {
        this.contexts.delete(platformId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.log(`🧹 Limpeza automática: ${cleaned} contexto(s) expirado(s) removido(s)`);
    }
  }

  /**
   * Retorna estatísticas do serviço
   */
  getStats(): {
    totalContexts: number;
    byPlatform: Record<string, number>;
    oldestContext: Date | null;
    newestContext: Date | null;
  } {
    const byPlatform: Record<string, number> = {};
    let oldest: number | null = null;
    let newest: number | null = null;

    for (const context of this.contexts.values()) {
      // Contar por plataforma
      byPlatform[context.platform] = (byPlatform[context.platform] || 0) + 1;

      // Rastrear mais antigo/mais novo
      if (oldest === null || context.lastActivity < oldest) {
        oldest = context.lastActivity;
      }
      if (newest === null || context.lastActivity > newest) {
        newest = context.lastActivity;
      }
    }

    return {
      totalContexts: this.contexts.size,
      byPlatform,
      oldestContext: oldest ? new Date(oldest) : null,
      newestContext: newest ? new Date(newest) : null,
    };
  }

  /**
   * Envia mensagem para o usuário na plataforma correta
   */
  async sendMessage(platformId: string, message: string): Promise<boolean> {
    const context = this.getContext(platformId);
    
    if (!context) {
      this.logger.warn(`⚠️ Tentativa de enviar mensagem sem contexto: ${platformId}`);
      return false;
    }

    try {
      if (context.platform === MessagingPlatform.WHATSAPP) {
        // Importação dinâmica para evitar dependência circular
        const { sendWhatsAppMessage } = await import('../simple-whatsapp-init');
        return await sendWhatsAppMessage(platformId, message);
      } else if (context.platform === MessagingPlatform.TELEGRAM) {
        this.logger.warn(`⚠️ Envio de mensagens Telegram ainda não implementado`);
        return false;
      }
      
      this.logger.warn(`⚠️ Plataforma desconhecida: ${context.platform}`);
      return false;
    } catch (error) {
      this.logger.error(`❌ Erro ao enviar mensagem para ${platformId}:`, error);
      return false;
    }
  }

  /**
   * Cleanup ao destruir o serviço
   */
  onModuleDestroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.logger.log('🛑 MessageContextService destruído');
  }
}
