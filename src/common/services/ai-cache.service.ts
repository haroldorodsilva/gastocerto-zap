import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import * as crypto from 'crypto';
import { AIProviderType, TransactionData } from '../../infrastructure/ai/ai.interface';

interface CacheEntry {
  provider: AIProviderType;
  result: TransactionData | string;
  timestamp: number;
  hits: number;
}

/**
 * AI Cache Service
 * Cacheia respostas de IA para evitar reprocessamento de mensagens idênticas
 *
 * Economia estimada: 30-50% de custo (muitos usuários mandam mensagens iguais)
 */
@Injectable()
export class AICacheService {
  private readonly logger = new Logger(AICacheService.name);
  private readonly redis: Redis;
  private readonly enabled: boolean;
  private readonly ttl: number; // Time to live em segundos

  constructor(private readonly configService: ConfigService) {
    // Configurar cache
    this.enabled = this.configService.get<boolean>('AI_CACHE_ENABLED', true);
    this.ttl = this.configService.get<number>('AI_CACHE_TTL', 86400); // 24 horas padrão

    // Inicializar Redis
    const redisUrl = this.configService.get<string>('REDIS_URL');
    const redisHost = this.configService.get<string>('REDIS_HOST', 'localhost');
    const redisPort = this.configService.get<number>('REDIS_PORT', 6379);

    if (redisUrl) {
      this.redis = new Redis(redisUrl);
    } else {
      this.redis = new Redis({
        host: redisHost,
        port: redisPort,
      });
    }

    if (this.enabled) {
      this.logger.log(`✅ AICacheService habilitado (TTL: ${this.ttl}s)`);
    } else {
      this.logger.warn('⚠️  AICacheService desabilitado via configuração');
    }
  }

  /**
   * Gera hash único para text + provider
   */
  private generateHash(text: string, provider: AIProviderType, operation: string): string {
    const content = `${provider}:${operation}:${text.trim().toLowerCase()}`;
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Gera hash para buffer (imagem/áudio)
   */
  private generateBufferHash(buffer: Buffer, provider: AIProviderType, operation: string): string {
    const bufferHash = crypto.createHash('sha256').update(buffer).digest('hex');
    return crypto
      .createHash('sha256')
      .update(`${provider}:${operation}:${bufferHash}`)
      .digest('hex');
  }

  /**
   * Busca resultado em cache (texto)
   */
  async getCachedText(
    text: string,
    provider: AIProviderType,
    operation: 'extract' | 'category' = 'extract',
  ): Promise<TransactionData | string | null> {
    if (!this.enabled) return null;

    try {
      const hash = this.generateHash(text, provider, operation);
      const cacheKey = `ai-cache:text:${hash}`;

      const cached = await this.redis.get(cacheKey);
      if (!cached) return null;

      const entry: CacheEntry = JSON.parse(cached);

      // Incrementa contador de hits
      entry.hits++;
      await this.redis.set(cacheKey, JSON.stringify(entry), 'EX', this.ttl);

      this.logger.debug(
        `💾 Cache HIT: ${provider} ${operation} (hits: ${entry.hits}, age: ${Math.floor((Date.now() - entry.timestamp) / 1000)}s)`,
      );

      return entry.result;
    } catch (error) {
      this.logger.error(`Erro ao buscar cache: ${error.message}`);
      return null;
    }
  }

  /**
   * Busca resultado em cache (buffer - imagem/áudio)
   */
  async getCachedBuffer(
    buffer: Buffer,
    provider: AIProviderType,
    operation: 'image' | 'audio' = 'image',
  ): Promise<TransactionData | string | null> {
    if (!this.enabled) return null;

    try {
      const hash = this.generateBufferHash(buffer, provider, operation);
      const cacheKey = `ai-cache:buffer:${hash}`;

      const cached = await this.redis.get(cacheKey);
      if (!cached) return null;

      const entry: CacheEntry = JSON.parse(cached);

      // Incrementa contador de hits
      entry.hits++;
      await this.redis.set(cacheKey, JSON.stringify(entry), 'EX', this.ttl);

      this.logger.debug(
        `💾 Cache HIT: ${provider} ${operation} (hits: ${entry.hits}, age: ${Math.floor((Date.now() - entry.timestamp) / 1000)}s)`,
      );

      return entry.result;
    } catch (error) {
      this.logger.error(`Erro ao buscar cache de buffer: ${error.message}`);
      return null;
    }
  }

  /**
   * Salva resultado em cache (texto)
   */
  async cacheText(
    text: string,
    provider: AIProviderType,
    result: TransactionData | string,
    operation: 'extract' | 'category' = 'extract',
  ): Promise<void> {
    if (!this.enabled) return;

    try {
      const hash = this.generateHash(text, provider, operation);
      const cacheKey = `ai-cache:text:${hash}`;

      const entry: CacheEntry = {
        provider,
        result,
        timestamp: Date.now(),
        hits: 0,
      };

      await this.redis.set(cacheKey, JSON.stringify(entry), 'EX', this.ttl);

      this.logger.debug(`💾 Cached: ${provider} ${operation}`);
    } catch (error) {
      this.logger.error(`Erro ao salvar cache: ${error.message}`);
    }
  }

  /**
   * Salva resultado em cache (buffer)
   */
  async cacheBuffer(
    buffer: Buffer,
    provider: AIProviderType,
    result: TransactionData | string,
    operation: 'image' | 'audio' = 'image',
  ): Promise<void> {
    if (!this.enabled) return;

    try {
      const hash = this.generateBufferHash(buffer, provider, operation);
      const cacheKey = `ai-cache:buffer:${hash}`;

      const entry: CacheEntry = {
        provider,
        result,
        timestamp: Date.now(),
        hits: 0,
      };

      await this.redis.set(cacheKey, JSON.stringify(entry), 'EX', this.ttl);

      this.logger.debug(
        `💾 Cached: ${provider} ${operation} (${(buffer.length / 1024).toFixed(2)} KB)`,
      );
    } catch (error) {
      this.logger.error(`Erro ao salvar cache de buffer: ${error.message}`);
    }
  }

  /**
   * Obtém estatísticas do cache
   */
  async getStats(): Promise<{
    totalKeys: number;
    textKeys: number;
    bufferKeys: number;
    estimatedSize: string;
    topHits: Array<{ key: string; hits: number }>;
  }> {
    try {
      const [textKeys, bufferKeys] = await Promise.all([
        this.redis.keys('ai-cache:text:*'),
        this.redis.keys('ai-cache:buffer:*'),
      ]);

      // Buscar top 10 mais acessados
      const allKeys = [...textKeys, ...bufferKeys];
      const entries = await Promise.all(
        allKeys.slice(0, 100).map(async (key) => {
          const data = await this.redis.get(key);
          if (!data) return null;
          const entry: CacheEntry = JSON.parse(data);
          return { key, hits: entry.hits };
        }),
      );

      const topHits = entries
        .filter((e) => e !== null)
        .sort((a, b) => b!.hits - a!.hits)
        .slice(0, 10) as Array<{ key: string; hits: number }>;

      // Estimar tamanho (sample de 10 keys)
      let totalSize = 0;
      const sampleKeys = allKeys.slice(0, 10);
      for (const key of sampleKeys) {
        const data = await this.redis.get(key);
        if (data) totalSize += data.length;
      }
      const avgSize = totalSize / sampleKeys.length;
      const estimatedTotal = avgSize * allKeys.length;

      return {
        totalKeys: allKeys.length,
        textKeys: textKeys.length,
        bufferKeys: bufferKeys.length,
        estimatedSize: `${(estimatedTotal / 1024 / 1024).toFixed(2)} MB`,
        topHits,
      };
    } catch (error) {
      this.logger.error(`Erro ao obter stats do cache: ${error.message}`);
      return {
        totalKeys: 0,
        textKeys: 0,
        bufferKeys: 0,
        estimatedSize: '0 MB',
        topHits: [],
      };
    }
  }

  /**
   * Limpa todo o cache
   */
  async clearAll(): Promise<number> {
    try {
      const keys = await this.redis.keys('ai-cache:*');
      if (keys.length === 0) return 0;

      await this.redis.del(...keys);
      this.logger.log(`🗑️  Cache limpo: ${keys.length} chaves removidas`);
      return keys.length;
    } catch (error) {
      this.logger.error(`Erro ao limpar cache: ${error.message}`);
      return 0;
    }
  }

  /**
   * Limpa cache de um provider específico
   */
  async clearProvider(provider: AIProviderType): Promise<number> {
    try {
      const keys = await this.redis.keys('ai-cache:*');
      let removed = 0;

      for (const key of keys) {
        const data = await this.redis.get(key);
        if (data) {
          const entry: CacheEntry = JSON.parse(data);
          if (entry.provider === provider) {
            await this.redis.del(key);
            removed++;
          }
        }
      }

      this.logger.log(`🗑️  Cache de ${provider} limpo: ${removed} chaves removidas`);
      return removed;
    } catch (error) {
      this.logger.error(`Erro ao limpar cache do provider: ${error.message}`);
      return 0;
    }
  }
}
