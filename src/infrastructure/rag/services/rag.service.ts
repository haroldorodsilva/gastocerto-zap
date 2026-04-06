import { Injectable, Logger } from '@nestjs/common';
import { CategoryMatch, RAGConfig, UserCategory } from './rag.interface';
import { RagCacheService } from './rag-cache.service';
import { RagSearchService } from './rag-search.service';
import { RagAnalyticsService } from './rag-analytics.service';

/**
 * RAGService — Facade
 *
 * Mantém a API pública original para compatibilidade com todos os callers
 * existentes (registration, account-management, user-cache, admin, etc.).
 *
 * Internamente, delega para os serviços especializados:
 * - RagCacheService  → operações de cache (Redis/Map)
 * - RagSearchService → BM25, embeddings, detectUnknownTerm
 * - RagAnalyticsService → logs de busca para analytics
 *
 * IMPORTANTE — accountId:
 * Todas as operações de cache, busca e sinônimos são isoladas por conta
 * no modelo n:m. Passe sempre `accountId` quando disponível.
 */
@Injectable()
export class RAGService {
  private readonly logger = new Logger(RAGService.name);

  constructor(
    private readonly ragCache: RagCacheService,
    private readonly ragSearch: RagSearchService,
    private readonly ragAnalytics: RagAnalyticsService,
  ) {
    this.logger.log('🧠 RAGService (facade) inicializado');
  }

  // ─────────────────────────────── Cache ───────────────────────────────────

  /**
   * Indexa categorias no cache.
   * @param accountId - Isola por conta no modelo n:m.
   */
  async indexUserCategories(
    userId: string,
    categories: UserCategory[],
    accountId?: string | null,
  ): Promise<void> {
    return this.ragCache.index(userId, accountId ?? null, categories);
  }

  /**
   * Retorna categorias do cache.
   * @param accountId - Isola por conta no modelo n:m.
   */
  async getCachedCategories(
    userId: string,
    accountId?: string | null,
  ): Promise<UserCategory[]> {
    return this.ragCache.get(userId, accountId);
  }

  /**
   * Remove entrada do cache.
   */
  async clearCache(userId?: string, accountId?: string | null): Promise<void> {
    if (userId) {
      await this.ragCache.clear(userId, accountId);
    } else {
      this.ragCache.clearAll();
    }
  }

  // ─────────────────────────────── Busca ───────────────────────────────────

  /**
   * Busca categorias similares via BM25 + sinônimos + bigrams.
   * @param config.accountId - Isola cache e sinônimos por conta (n:m).
   */
  async findSimilarCategories(
    text: string,
    userId: string,
    config: Partial<RAGConfig> & { skipLogging?: boolean; accountId?: string | null } = {},
  ): Promise<CategoryMatch[]> {
    return this.ragSearch.findSimilarCategories(text, userId, config);
  }

  /**
   * Busca por similaridade de cosseno com embeddings de IA.
   * @param config.accountId - Isola cache por conta (n:m).
   */
  async findSimilarCategoriesWithEmbeddings(
    text: string,
    userId: string,
    aiProvider: any,
    config: Partial<RAGConfig> & { accountId?: string | null } = {},
  ): Promise<CategoryMatch[]> {
    return this.ragSearch.findSimilarCategoriesWithEmbeddings(text, userId, aiProvider, config);
  }

  /**
   * Detecta termo desconhecido na mensagem e sugere aprendizado.
   * @param accountId - Isola categorias por conta (n:m).
   */
  async detectUnknownTerm(
    text: string,
    userId: string,
    accountId?: string | null,
  ): Promise<{
    detectedTerm: string;
    isKnownSubcategory: boolean;
    suggestedCategory?: string;
    suggestedCategoryId?: string;
    suggestedSubcategory?: string;
    suggestedSubcategoryId?: string;
    confidence: number;
    reason: string;
  } | null> {
    return this.ragSearch.detectUnknownTerm(text, userId, accountId);
  }

  // ─────────────────────────────── Analytics ───────────────────────────────

  /**
   * Registra busca com contexto de multi-step flow (usado por CategoryResolutionService).
   */
  async logSearchWithContext(params: {
    userId: string;
    query: string;
    matches: CategoryMatch[];
    success: boolean;
    threshold: number;
    ragMode: string;
    responseTime: number;
    flowStep?: number;
    totalSteps?: number;
    aiProvider?: string;
    aiModel?: string;
    aiConfidence?: number;
    aiCategoryId?: string;
    aiCategoryName?: string;
    finalCategoryId?: string;
    finalCategoryName?: string;
    wasAiFallback?: boolean;
  }): Promise<string | null> {
    return this.ragAnalytics.logWithContext(params);
  }

  /**
   * Retorna logs de busca para analytics (admin).
   */
  async getSearchAttempts(
    userId?: string,
    failedOnly: boolean = false,
    limit: number = 20,
    offset: number = 0,
  ) {
    return this.ragAnalytics.getSearchAttempts(userId, failedOnly, limit, offset);
  }

  /**
   * Remove logs de busca por IDs (admin).
   */
  async deleteSearchLogs(ids: string[]): Promise<{ deletedCount: number }> {
    return this.ragAnalytics.deleteSearchLogs(ids);
  }
}
