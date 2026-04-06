import { Injectable, Logger } from '@nestjs/common';
import { CategoryMatch, RAGConfig, UserCategory } from './rag.interface';
import { RagCacheService } from './rag-cache.service';
import { RagSearchService } from './rag-search.service';
import { RagAnalyticsService } from './rag-analytics.service';
import { TextProcessingService } from './text-processing.service';
import { RagScoringService } from './rag-scoring.service';

/**
 * RAGService — Facade
 *
 * API pública do módulo RAG. Delega para serviços especializados:
 * - RagCacheService       → cache Redis/Map isolado por conta
 * - RagSearchService      → BM25, embeddings, detectUnknownTerm
 * - RagAnalyticsService   → logs de busca
 * - TextProcessingService → normalize/tokenize (exposto para admin debug)
 * - RagScoringService     → BM25 scoring (exposto para admin debug)
 *
 * MODELO n:m — accountId OBRIGATÓRIO:
 * Todos os dados (cache, sinônimos, doc-freq) são isolados por conta.
 * Um usuário pode ter várias contas; cada conta tem categorias independentes.
 * Nunca use userId como escopo de dados RAG.
 */
@Injectable()
export class RAGService {
  private readonly logger = new Logger(RAGService.name);

  constructor(
    private readonly ragCache: RagCacheService,
    private readonly ragSearch: RagSearchService,
    private readonly ragAnalytics: RagAnalyticsService,
    private readonly textProcessing: TextProcessingService,
    private readonly ragScoring: RagScoringService,
  ) {
    this.logger.log('🧠 RAGService (facade) inicializado');
  }

  // ─────────────────────────────── Cache ───────────────────────────────────

  /**
   * Indexa categorias no cache da conta.
   * @param accountId - OBRIGATÓRIO: isola por conta no modelo n:m.
   */
  async indexUserCategories(
    userId: string,
    categories: UserCategory[],
    accountId: string,
  ): Promise<void> {
    return this.ragCache.index(userId, accountId, categories);
  }

  /**
   * Retorna categorias do cache da conta.
   * @param accountId - OBRIGATÓRIO: isola por conta no modelo n:m.
   */
  async getCachedCategories(
    userId: string,
    accountId: string,
  ): Promise<UserCategory[]> {
    return this.ragCache.get(userId, accountId);
  }

  /**
   * Remove cache de uma conta específica.
   * Sem argumentos, limpa todo o cache em memória (apenas para testes/admin).
   */
  async clearCache(userId?: string, accountId?: string): Promise<void> {
    if (userId && accountId) {
      await this.ragCache.clear(userId, accountId);
    } else {
      this.ragCache.clearAll();
    }
  }

  // ─────────────────────────────── Busca ───────────────────────────────────

  /**
   * Busca categorias similares via BM25 + sinônimos + bigrams.
   * @param config.accountId - OBRIGATÓRIO: isola cache e sinônimos por conta (n:m).
   */
  async findSimilarCategories(
    text: string,
    userId: string,
    config: Partial<RAGConfig> & { skipLogging?: boolean; accountId: string } = {} as any,
  ): Promise<CategoryMatch[]> {
    return this.ragSearch.findSimilarCategories(text, userId, config);
  }

  /**
   * Busca por similaridade de cosseno com embeddings de IA.
   * @param config.accountId - OBRIGATÓRIO: isola cache por conta (n:m).
   */
  async findSimilarCategoriesWithEmbeddings(
    text: string,
    userId: string,
    aiProvider: any,
    config: Partial<RAGConfig> & { accountId: string } = {} as any,
  ): Promise<CategoryMatch[]> {
    return this.ragSearch.findSimilarCategoriesWithEmbeddings(text, userId, aiProvider, config);
  }

  /**
   * Detecta termo desconhecido na mensagem e sugere aprendizado.
   * @param accountId - OBRIGATÓRIO: isola categorias por conta (n:m).
   */
  async detectUnknownTerm(
    text: string,
    userId: string,
    accountId: string,
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

  // ───────────────────────── Debug / Admin ─────────────────────────────────

  /**
   * Normaliza texto (remove acentos, lowercase, etc.).
   * Exposto para admin debug — não usar em fluxos de produção diretamente.
   */
  normalizeText(text: string): string {
    return this.textProcessing.normalize(text);
  }

  /**
   * Tokeniza texto normalizado em array de tokens.
   * Exposto para admin debug — não usar em fluxos de produção diretamente.
   */
  tokenizeText(text: string): string[] {
    return this.textProcessing.tokenize(text);
  }

  /**
   * Calcula score BM25 entre query tokens e doc tokens.
   * Exposto para admin debug — não usar em fluxos de produção diretamente.
   */
  calculateBM25Score(queryTokens: string[], docTokens: string[]): number {
    return this.ragScoring.calculateBM25Score(queryTokens, docTokens);
  }
}
