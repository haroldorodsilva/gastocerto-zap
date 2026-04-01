import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '@common/services/redis.service';

export interface ConversationEntry {
  role: 'user' | 'bot';
  text: string;
  intent?: string;
  timestamp: number;
}

const MEMORY_PREFIX = 'conv_mem:';
const MAX_ENTRIES = 10;
const TTL_SECONDS = 30 * 60; // 30 minutos

/**
 * Memória de curto prazo para conversas.
 * Armazena as últimas mensagens por usuário no Redis com TTL de 30min.
 * Permite que o bot entenda contexto multi-turno (ex: "e de ontem?" após listar transações).
 */
@Injectable()
export class ConversationMemoryService {
  private readonly logger = new Logger(ConversationMemoryService.name);

  constructor(private readonly redisService: RedisService) {}

  private getKey(phoneNumber: string): string {
    return `${MEMORY_PREFIX}${phoneNumber}`;
  }

  /**
   * Adiciona uma entrada (mensagem do user ou resposta do bot) ao histórico
   */
  async addEntry(phoneNumber: string, entry: Omit<ConversationEntry, 'timestamp'>): Promise<void> {
    try {
      if (!this.redisService.isReady()) return;

      const client = this.redisService.getClient();
      const key = this.getKey(phoneNumber);

      const fullEntry: ConversationEntry = {
        ...entry,
        timestamp: Date.now(),
      };

      // push + trim + refresh TTL em pipeline
      await client
        .pipeline()
        .rpush(key, JSON.stringify(fullEntry))
        .ltrim(key, -MAX_ENTRIES, -1)
        .expire(key, TTL_SECONDS)
        .exec();
    } catch (error) {
      this.logger.warn(`Falha ao salvar memória: ${error.message}`);
    }
  }

  /**
   * Retorna o histórico recente de conversa
   */
  async getHistory(phoneNumber: string): Promise<ConversationEntry[]> {
    try {
      if (!this.redisService.isReady()) return [];

      const client = this.redisService.getClient();
      const key = this.getKey(phoneNumber);
      const raw = await client.lrange(key, 0, -1);

      return raw.map((r) => JSON.parse(r) as ConversationEntry);
    } catch (error) {
      this.logger.warn(`Falha ao ler memória: ${error.message}`);
      return [];
    }
  }

  /**
   * Retorna a última intenção identificada (útil para follow-ups)
   */
  async getLastIntent(phoneNumber: string): Promise<string | null> {
    const history = await this.getHistory(phoneNumber);

    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].intent) return history[i].intent;
    }

    return null;
  }

  /**
   * Limpa histórico do usuário
   */
  async clear(phoneNumber: string): Promise<void> {
    try {
      if (!this.redisService.isReady()) return;
      const client = this.redisService.getClient();
      await client.del(this.getKey(phoneNumber));
    } catch {
      // silent
    }
  }
}
