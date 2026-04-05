import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { UserCategory } from './rag.interface';

/**
 * RagCacheService
 *
 * Responsabilidade única: gerenciar o cache de categorias por usuário/conta.
 *
 * - Redis (padrão): persistente, TTL 24h, key = `rag:categories:${scope}`
 * - Map (fallback): em memória, não persistente
 * - Scope = accountId quando fornecido (n:m), userId caso contrário
 *
 * Isola toda a lógica de cache do RAGService principal.
 */
@Injectable()
export class RagCacheService {
  private readonly logger = new Logger(RagCacheService.name);
  private readonly useRedisCache: boolean;
  private readonly cacheTTL = 86400; // 24 horas em segundos
  private readonly memoryCache = new Map<string, UserCategory[]>();

  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly configService: ConfigService,
  ) {
    this.useRedisCache = this.configService.get<boolean>('RAG_CACHE_REDIS', true);
    this.logger.log(
      `🗄️ RagCacheService | Modo: ${this.useRedisCache ? 'Redis' : 'Map (fallback)'}`,
    );
  }

  private buildKey(userId: string, accountId?: string | null): string {
    // accountId isola categorias por conta no modelo n:m
    return `rag:categories:${accountId || userId}`;
  }

  /**
   * Indexa categorias no cache.
   * @param accountId - Quando fornecido, isola o cache por conta (n:m).
   */
  async index(
    userId: string,
    accountId: string | null,
    categories: UserCategory[],
  ): Promise<void> {
    const key = this.buildKey(userId, accountId);
    this.logger.log(
      `📚 Indexando ${categories.length} categorias | key: ${key}`,
    );

    if (this.useRedisCache) {
      await this.cacheManager.set(key, JSON.stringify(categories), this.cacheTTL * 1000);
      this.logger.debug(`✅ Redis: ${key}`);
    } else {
      this.memoryCache.set(key, categories);
      this.logger.debug(`⚠️ Map: ${key}`);
    }
  }

  /**
   * Retorna categorias do cache.
   * @param accountId - Quando fornecido, usa chave isolada por conta (n:m).
   */
  async get(userId: string, accountId?: string | null): Promise<UserCategory[]> {
    const key = this.buildKey(userId, accountId);

    if (this.useRedisCache) {
      const cached = await this.cacheManager.get<string>(key);
      if (cached) {
        const categories = JSON.parse(cached) as UserCategory[];
        this.logger.debug(`✅ Cache hit: ${key} (${categories.length} categorias)`);
        return categories;
      }
    } else {
      const categories = this.memoryCache.get(key) || [];
      this.logger.debug(`Map: ${key} (${categories.length} categorias)`);
      return categories;
    }

    return [];
  }

  /**
   * Remove entrada do cache.
   */
  async clear(userId: string, accountId?: string | null): Promise<void> {
    const key = this.buildKey(userId, accountId);
    if (this.useRedisCache) {
      await this.cacheManager.del(key);
    } else {
      this.memoryCache.delete(key);
    }
    this.logger.debug(`🗑️ Cache removido: ${key}`);
  }
}
