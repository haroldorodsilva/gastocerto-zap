import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MessagingPlatform } from '@infrastructure/messaging/messaging-provider.interface';
import { RedisService } from '@common/services/redis.service';
import { REPLY_EVENTS } from '@infrastructure/messaging/messaging-events.constants';

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
 * Redis key prefix para contextos
 */
const CONTEXT_PREFIX = 'msg_ctx:';

/**
 * Serviço que mantém o contexto de conversas ativas via Redis.
 *
 * Garante que mensagens sejam roteadas para a plataforma correta:
 * - Se mensagem veio do Telegram → resposta volta para Telegram
 * - Se mensagem veio do WhatsApp → resposta volta para WhatsApp
 *
 * O contexto é indexado por `platformId`:
 * - Telegram: chatId (ex: "707624962")
 * - WhatsApp: phoneNumber@s.whatsapp.net (ex: "5566996285154@s.whatsapp.net")
 *
 * Persistido no Redis — sobrevive a restarts e funciona em multi-instância.
 */
@Injectable()
export class MessageContextService implements OnModuleDestroy {
  private readonly logger = new Logger(MessageContextService.name);

  // TTL padrão: 1 hora (em segundos para Redis)
  private readonly DEFAULT_TTL_SECONDS = 60 * 60;

  constructor(
    private readonly redisService: RedisService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.logger.log('✅ MessageContextService inicializado (Redis-backed)');
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
  async registerContext(
    platformId: string,
    sessionId: string,
    platform: MessagingPlatform,
    userId?: string,
    phoneNumber?: string,
  ): Promise<void> {
    const now = Date.now();
    const context: MessageContext = {
      sessionId,
      platform,
      userId,
      phoneNumber,
      lastActivity: now,
      expiresAt: now + this.DEFAULT_TTL_SECONDS * 1000,
    };

    try {
      if (!this.redisService.isReady()) {
        this.logger.warn('⚠️ Redis não disponível — contexto não será persistido');
        return;
      }

      const key = `${CONTEXT_PREFIX}${platformId}`;
      const client = this.redisService.getClient();
      await client.set(key, JSON.stringify(context), 'EX', this.DEFAULT_TTL_SECONDS);

      this.logger.debug(
        `📝 Contexto registrado: ${platformId} → [${platform}] ${sessionId}` +
          (userId ? ` | userId: ${userId}` : '') +
          (phoneNumber ? ` | phone: ${phoneNumber}` : ''),
      );
    } catch (error) {
      this.logger.error(`❌ Erro ao registrar contexto: ${error.message}`);
    }
  }

  /**
   * Obtém contexto de uma conversa ativa
   *
   * @returns MessageContext se encontrado e válido, null caso contrário
   */
  async getContext(platformId: string): Promise<MessageContext | null> {
    try {
      if (!this.redisService.isReady()) {
        this.logger.warn('⚠️ Redis não disponível — contexto não encontrado');
        return null;
      }

      const key = `${CONTEXT_PREFIX}${platformId}`;
      const client = this.redisService.getClient();
      const raw = await client.get(key);

      if (!raw) {
        this.logger.debug(`❌ Contexto não encontrado: ${platformId}`);
        return null;
      }

      const context: MessageContext = JSON.parse(raw);

      // Atualizar lastActivity e renovar TTL
      context.lastActivity = Date.now();
      await client.set(key, JSON.stringify(context), 'EX', this.DEFAULT_TTL_SECONDS);

      this.logger.debug(
        `✅ Contexto encontrado: ${platformId} → [${context.platform}] ${context.sessionId}`,
      );

      return context;
    } catch (error) {
      this.logger.error(`❌ Erro ao obter contexto: ${error.message}`);
      return null;
    }
  }

  /**
   * Atualiza TTL de um contexto (renova expiração)
   */
  async renewContext(platformId: string, ttlSeconds?: number): Promise<boolean> {
    try {
      if (!this.redisService.isReady()) return false;

      const key = `${CONTEXT_PREFIX}${platformId}`;
      const client = this.redisService.getClient();
      const raw = await client.get(key);

      if (!raw) return false;

      const context: MessageContext = JSON.parse(raw);
      const ttl = ttlSeconds || this.DEFAULT_TTL_SECONDS;
      context.lastActivity = Date.now();
      context.expiresAt = Date.now() + ttl * 1000;

      await client.set(key, JSON.stringify(context), 'EX', ttl);

      this.logger.debug(
        `🔄 Contexto renovado: ${platformId} (TTL: ${ttl}s)`,
      );

      return true;
    } catch (error) {
      this.logger.error(`❌ Erro ao renovar contexto: ${error.message}`);
      return false;
    }
  }

  /**
   * Remove contexto manualmente
   */
  async removeContext(platformId: string): Promise<boolean> {
    try {
      if (!this.redisService.isReady()) return false;

      const key = `${CONTEXT_PREFIX}${platformId}`;
      const client = this.redisService.getClient();
      const deleted = await client.del(key);

      if (deleted > 0) {
        this.logger.debug(`🗑️  Contexto removido: ${platformId}`);
      }

      return deleted > 0;
    } catch (error) {
      this.logger.error(`❌ Erro ao remover contexto: ${error.message}`);
      return false;
    }
  }

  /**
   * Retorna estatísticas do serviço
   */
  async getStats(): Promise<{
    totalContexts: number;
    byPlatform: Record<string, number>;
    oldestContext: Date | null;
    newestContext: Date | null;
  }> {
    const byPlatform: Record<string, number> = {};
    let oldest: number | null = null;
    let newest: number | null = null;
    let totalContexts = 0;

    try {
      if (!this.redisService.isReady()) {
        return { totalContexts: 0, byPlatform, oldestContext: null, newestContext: null };
      }

      const client = this.redisService.getClient();
      const keys = await client.keys(`${CONTEXT_PREFIX}*`);
      totalContexts = keys.length;

      // Sample up to 100 keys for stats (avoid scanning all in large deployments)
      const sampleKeys = keys.slice(0, 100);
      if (sampleKeys.length > 0) {
        const values = await client.mget(...sampleKeys);
        for (const raw of values) {
          if (!raw) continue;
          try {
            const context: MessageContext = JSON.parse(raw);
            byPlatform[context.platform] = (byPlatform[context.platform] || 0) + 1;
            if (oldest === null || context.lastActivity < oldest) oldest = context.lastActivity;
            if (newest === null || context.lastActivity > newest) newest = context.lastActivity;
          } catch { /* skip malformed */ }
        }
      }
    } catch (error) {
      this.logger.error(`❌ Erro ao obter stats: ${error.message}`);
    }

    return {
      totalContexts,
      byPlatform,
      oldestContext: oldest ? new Date(oldest) : null,
      newestContext: newest ? new Date(newest) : null,
    };
  }

  /**
   * Envia mensagem para o usuário na plataforma correta.
   * Delega para o sistema de eventos (REPLY_EVENTS) que é processado pelo MessageResponseService.
   */
  async sendMessage(platformId: string, message: string): Promise<boolean> {
    const context = await this.getContext(platformId);

    if (!context) {
      this.logger.warn(`⚠️ Tentativa de enviar mensagem sem contexto: ${platformId}`);
      return false;
    }

    try {
      const eventName =
        context.platform === MessagingPlatform.TELEGRAM
          ? REPLY_EVENTS.TELEGRAM
          : REPLY_EVENTS.WHATSAPP;

      this.eventEmitter.emit(eventName, {
        platformId,
        message,
        context: 'INTENT_RESPONSE',
        platform: context.platform,
        sessionId: context.sessionId,
      });

      return true;
    } catch (error) {
      this.logger.error(`❌ Erro ao enviar mensagem para ${platformId}:`, error);
      return false;
    }
  }

  /**
   * Cleanup ao destruir o serviço
   */
  onModuleDestroy(): void {
    this.logger.log('🛑 MessageContextService destruído');
  }
}
