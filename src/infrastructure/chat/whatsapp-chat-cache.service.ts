import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@common/services/redis.service';

export interface CachedMessage {
  id: string;
  chatId: string;
  from: string;
  fromMe: boolean;
  text?: string;
  messageType: string;
  timestamp: number;
  pushName?: string;
}

export interface CachedChat {
  chatId: string;
  name: string;
  isGroup: boolean;
  lastMessageTimestamp: number;
  lastMessageText?: string;
  unreadCount: number;
}

/**
 * Serviço de cache de chats e mensagens do WhatsApp no Redis
 * TTL: 4 horas (14400 segundos)
 */
@Injectable()
export class WhatsAppChatCacheService {
  private readonly logger = new Logger(WhatsAppChatCacheService.name);
  private readonly CACHE_TTL = 14400; // 4 horas em segundos
  private readonly CACHE_PREFIX = 'whatsapp:cache';

  constructor(private readonly redisService: RedisService) {}

  /**
   * Adiciona ou atualiza um chat no cache
   */
  async cacheChat(sessionId: string, chat: CachedChat): Promise<void> {
    try {
      const key = `${this.CACHE_PREFIX}:${sessionId}:chat:${chat.chatId}`;
      const redis = this.redisService.getClient();
      await redis.setex(key, this.CACHE_TTL, JSON.stringify(chat));

      // Adicionar à lista de chats da sessão
      const listKey = `${this.CACHE_PREFIX}:${sessionId}:chats`;
      await redis.zadd(listKey, chat.lastMessageTimestamp, chat.chatId);
      await redis.expire(listKey, this.CACHE_TTL);

      this.logger.debug(`📦 Chat cached: ${chat.chatId} (${chat.name})`);
    } catch (error) {
      this.logger.error(`❌ Error caching chat ${chat.chatId}:`, error);
    }
  }

  /**
   * Adiciona mensagem ao cache
   */
  async cacheMessage(sessionId: string, message: CachedMessage): Promise<void> {
    try {
      const redis = this.redisService.getClient();
      const key = `${this.CACHE_PREFIX}:${sessionId}:messages:${message.chatId}`;
      await redis.zadd(key, message.timestamp, JSON.stringify(message));
      await redis.expire(key, this.CACHE_TTL);

      // Manter apenas as últimas 100 mensagens
      await redis.zremrangebyrank(key, 0, -101);

      this.logger.debug(`📦 Message cached: ${message.id} in chat ${message.chatId}`);
    } catch (error) {
      this.logger.error(`❌ Error caching message ${message.id}:`, error);
    }
  }

  /**
   * Busca todos os chats de uma sessão
   */
  async getChats(sessionId: string, limit = 50): Promise<CachedChat[]> {
    try {
      const redis = this.redisService.getClient();
      const listKey = `${this.CACHE_PREFIX}:${sessionId}:chats`;

      // Buscar IDs dos chats ordenados por timestamp (mais recentes primeiro)
      const chatIds = await redis.zrevrange(listKey, 0, limit - 1);

      if (chatIds.length === 0) {
        return [];
      }

      // Buscar dados de cada chat
      const pipeline = redis.pipeline();
      chatIds.forEach((chatId) => {
        const key = `${this.CACHE_PREFIX}:${sessionId}:chat:${chatId}`;
        pipeline.get(key);
      });

      const results = await pipeline.exec();
      const chats: CachedChat[] = [];

      results?.forEach((result) => {
        if (result && result[1]) {
          try {
            chats.push(JSON.parse(result[1] as string));
          } catch (error) {
            this.logger.error('Error parsing cached chat:', error);
          }
        }
      });

      this.logger.log(`📦 Retrieved ${chats.length} chats from cache for session ${sessionId}`);
      return chats;
    } catch (error) {
      this.logger.error(`❌ Error getting cached chats:`, error);
      return [];
    }
  }

  /**
   * Busca mensagens de um chat
   */
  async getChatMessages(sessionId: string, chatId: string, limit = 50): Promise<CachedMessage[]> {
    try {
      const redis = this.redisService.getClient();
      const key = `${this.CACHE_PREFIX}:${sessionId}:messages:${chatId}`;

      // Buscar últimas mensagens (ordenadas por timestamp, mais recentes primeiro)
      const messagesJson = await redis.zrevrange(key, 0, limit - 1);

      const messages: CachedMessage[] = messagesJson
        .map((json) => {
          try {
            return JSON.parse(json);
          } catch (error) {
            this.logger.error('Error parsing cached message:', error);
            return null;
          }
        })
        .filter((msg): msg is CachedMessage => msg !== null);

      this.logger.log(`📦 Retrieved ${messages.length} messages from cache for chat ${chatId}`);
      return messages;
    } catch (error) {
      this.logger.error(`❌ Error getting cached messages:`, error);
      return [];
    }
  }

  /**
   * Incrementa contador de mensagens não lidas
   */
  async incrementUnreadCount(sessionId: string, chatId: string): Promise<void> {
    try {
      const redis = this.redisService.getClient();
      const key = `${this.CACHE_PREFIX}:${sessionId}:chat:${chatId}`;
      const chatJson = await redis.get(key);

      if (chatJson) {
        const chat: CachedChat = JSON.parse(chatJson);
        chat.unreadCount = (chat.unreadCount || 0) + 1;
        await redis.setex(key, this.CACHE_TTL, JSON.stringify(chat));
      }
    } catch (error) {
      this.logger.error(`❌ Error incrementing unread count:`, error);
    }
  }

  /**
   * Zera contador de mensagens não lidas
   */
  async resetUnreadCount(sessionId: string, chatId: string): Promise<void> {
    try {
      const redis = this.redisService.getClient();
      const key = `${this.CACHE_PREFIX}:${sessionId}:chat:${chatId}`;
      const chatJson = await redis.get(key);

      if (chatJson) {
        const chat: CachedChat = JSON.parse(chatJson);
        chat.unreadCount = 0;
        await redis.setex(key, this.CACHE_TTL, JSON.stringify(chat));
      }
    } catch (error) {
      this.logger.error(`❌ Error resetting unread count:`, error);
    }
  }

  /**
   * Limpa todo o cache de uma sessão
   */
  async clearSessionCache(sessionId: string): Promise<void> {
    try {
      const redis = this.redisService.getClient();
      const pattern = `${this.CACHE_PREFIX}:${sessionId}:*`;
      const keys = await redis.keys(pattern);

      if (keys.length > 0) {
        await redis.del(...keys);
        this.logger.log(`🗑️  Cleared ${keys.length} cache keys for session ${sessionId}`);
      }
    } catch (error) {
      this.logger.error(`❌ Error clearing session cache:`, error);
    }
  }

  /**
   * Busca um chat específico
   */
  async getChat(sessionId: string, chatId: string): Promise<CachedChat | null> {
    try {
      const redis = this.redisService.getClient();
      const key = `${this.CACHE_PREFIX}:${sessionId}:chat:${chatId}`;
      const chatJson = await redis.get(key);

      if (!chatJson) {
        return null;
      }

      return JSON.parse(chatJson);
    } catch (error) {
      this.logger.error(`❌ Error getting cached chat:`, error);
      return null;
    }
  }
}
