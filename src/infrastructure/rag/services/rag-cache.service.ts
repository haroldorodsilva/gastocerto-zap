import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { Cache } from 'cache-manager';
import { UserCategory } from './rag.interface';

/**
 * RagCacheService
 *
 * Responsabilidade única: gerenciar o cache de categorias por conta.
 *
 * - Redis (padrão): persistente, TTL 24h, key = `rag:categories:${accountId}`
 * - Map (fallback): em memória, não persistente
 * - Scope = SEMPRE accountId — dados isolados por conta (modelo n:m)
 *
 * IMPORTANTE: accountId é obrigatório. Dados são isolados por conta,
 * não por usuário. Um usuário pode ter múltiplas contas com categorias
 * independentes.
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

  /** Chave de cache isolada por conta. accountId é a fonte da verdade. */
  private buildKey(accountId: string): string {
    return `rag:categories:${accountId}`;
  }

  /**
   * Indexa categorias no cache da conta.
   * @param accountId - Obrigatório: isola dados por conta (n:m).
   */
  async index(
    userId: string,
    accountId: string,
    categories: UserCategory[],
  ): Promise<void> {
    const key = this.buildKey(accountId);
    this.logger.log(
      `📚 Indexando ${categories.length} categorias | userId=${userId} accountId=${accountId} key=${key}`,
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
   * Retorna categorias do cache da conta.
   * @param accountId - Obrigatório: chave de isolamento por conta (n:m).
   */
  async get(userId: string, accountId: string): Promise<UserCategory[]> {
    const key = this.buildKey(accountId);

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
   * Remove entrada do cache de uma conta específica.
   * @param accountId - Obrigatório: chave de isolamento por conta (n:m).
   */
  async clear(userId: string, accountId: string): Promise<void> {
    const key = this.buildKey(accountId);
    if (this.useRedisCache) {
      await this.cacheManager.del(key);
    } else {
      this.memoryCache.delete(key);
    }
    this.logger.debug(`🗑️ Cache removido: ${key}`);
  }

  /**
   * Limpa todo o cache em memória (fallback Map).
   * No Redis, não há operação equivalente segura — use admin endpoint.
   */
  clearAll(): void {
    if (!this.useRedisCache) {
      this.memoryCache.clear();
      this.logger.debug(`🗑️ Todo cache Map limpo`);
    } else {
      this.logger.warn('⚠️ clearAll() não suportado no Redis — use admin endpoint');
    }
  }
}
