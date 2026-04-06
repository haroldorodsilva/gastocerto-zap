import { Injectable, Logger } from '@nestjs/common';
import { RagCacheService } from './rag-cache.service';
import { RagScoringService } from './rag-scoring.service';
import { RagAnalyticsService } from './rag-analytics.service';
import { TextProcessingService } from './text-processing.service';
import { UserSynonymService } from './user-synonym.service';
import { CategoryMatch, RAGConfig, UserCategory } from './rag.interface';
import { FILTER_WORDS_FOR_TERM_DETECTION } from '@common/constants/nlp-keywords.constants';

/**
 * RagSearchService
 *
 * Responsabilidade: orquestrar o fluxo completo de busca de categorias.
 * É o "motor" do RAG — combina cache, scoring, sinônimos e analytics.
 *
 * PIPELINE findSimilarCategories:
 * 1. Carregar categorias do cache (via RagCacheService, scope por accountId)
 * 2. Filtrar por tipo de transação (INCOME/EXPENSES)
 * 3. Buscar sinônimos personalizados da conta (via UserSynonymService)
 * 4. Para cada categoria: BM25 + boosts (subcategoria, sinônimos, bigrams)
 * 5. Normalizar scores com quality gate
 * 6. Fire-and-forget analytics (não bloqueia resposta)
 *
 * TODOS os métodos recebem accountId para isolamento n:m:
 * - Cache key:  rag:categories:${accountId}
 * - Sinônimos:  filtrados por accountId
 * - DocFreq:    cache key inclui accountId
 */
@Injectable()
export class RagSearchService {
  private readonly logger = new Logger(RagSearchService.name);

  private readonly defaultConfig: RAGConfig = {
    minScore: 0.25,
    maxResults: 3,
    boostExactMatch: 2.0,
    boostStartsWith: 1.5,
  };

  constructor(
    private readonly ragCache: RagCacheService,
    private readonly scoring: RagScoringService,
    private readonly analytics: RagAnalyticsService,
    private readonly textProcessing: TextProcessingService,
    private readonly userSynonymService: UserSynonymService,
  ) {}

  // ─────────────────────────────── BM25 ────────────────────────────────────

  /**
   * Busca categorias similares usando BM25 + sinônimos + bigrams.
   *
   * @param config.accountId - Isola cache e sinônimos por conta (n:m obrigatório).
   * @param config.skipLogging - Evita log duplicado quando chamado internamente.
   */
  async findSimilarCategories(
    text: string,
    userId: string,
    config: Partial<RAGConfig> & { skipLogging?: boolean; accountId: string } = {} as any,
  ): Promise<CategoryMatch[]> {
    const startTime = Date.now();
    const { skipLogging, accountId, ...configRest } = config;
    const finalConfig = { ...this.defaultConfig, ...configRest };

    // 1. Carregar categorias do cache isolado por conta
    let categories = await this.ragCache.get(userId, accountId);

    if (categories.length === 0) {
      this.logger.warn(`⚠️ Nenhuma categoria no cache | userId=${userId} accountId=${accountId}`);
      return [];
    }

    // 2. Filtrar por tipo de transação
    if (finalConfig.transactionType) {
      const before = categories.length;
      categories = categories.filter((c) => c.type === finalConfig.transactionType);
      this.logger.log(
        `🔍 Filtro tipo ${finalConfig.transactionType}: ${before} → ${categories.length}`,
      );
      if (categories.length === 0) return [];
    }

    // 3. Normalizar e tokenizar query
    const normalizedQuery = this.textProcessing.normalize(text);
    const queryTokens = this.textProcessing.tokenize(normalizedQuery);
    const queryBigrams = this.scoring.buildBigrams(queryTokens);

    this.logger.debug(`🔍 Query: "${text}" → tokens: [${queryTokens.join(', ')}] | bigrams: [${queryBigrams.join(', ')}]`);

    // 4. Buscar sinônimos personalizados da conta (accountId-scoped)
    const userSynonyms = await this.userSynonymService.getUserSynonyms(
      userId,
      normalizedQuery,
      accountId,
    );

    if (userSynonyms.length > 0) {
      this.logger.log(`🎯 ${userSynonyms.length} sinônimos personalizados para "${text}"`);
    }

    // 5. Pré-computar frequência de documentos (chave isolada por conta)
    const docFreqCacheKey = `df:${accountId}:${finalConfig.transactionType || 'all'}`;
    const { totalDocs, docFreqMap, avgDocLength } = this.scoring.precomputeDocFrequencies(
      categories,
      docFreqCacheKey,
    );

    // 6. Calcular score para cada categoria
    const matches: CategoryMatch[] = [];

    for (const category of categories) {
      const categoryText = `${category.name} ${category.subCategory?.name || ''}`;
      const normalizedCategory = this.textProcessing.normalize(categoryText);
      const categoryTokens = this.textProcessing.tokenize(normalizedCategory);
      const subCategoryTokens = category.subCategory?.name
        ? this.textProcessing.tokenize(this.textProcessing.normalize(category.subCategory.name))
        : [];

      // ── Score base BM25 ──────────────────────────────────────────────────
      let score = this.scoring.calculateBM25Score(
        queryTokens,
        categoryTokens,
        totalDocs,
        docFreqMap,
        avgDocLength,
      );

      // ── Boosts de subcategoria (maior prioridade) ─────────────────────────
      if (category.subCategory?.name) {
        const normalizedSubCat = this.textProcessing.normalize(category.subCategory.name);
        const subCatOnlyTokens = this.textProcessing.tokenize(normalizedSubCat);
        const validSubCatTokens = subCatOnlyTokens.filter((t) => t.length >= 3);

        // Match direto: subcategoria completa como palavra na query
        const subCatRegex = new RegExp(`\\b${normalizedSubCat}\\b`, 'i');
        const isDirectMatch = normalizedSubCat.length >= 3 && subCatRegex.test(normalizedQuery);

        // Todos os tokens válidos da subcategoria presentes na query
        const allTokensMatch =
          validSubCatTokens.length > 0 &&
          validSubCatTokens.every((sct) => queryTokens.includes(sct));

        if (isDirectMatch) {
          score += 10.0;
          this.logger.debug(`🔥 Match direto subcategoria "${category.subCategory.name}" +10`);
        } else if (allTokensMatch) {
          score += 8.0;
          this.logger.debug(`🔥 Todos tokens subcategoria "${category.subCategory.name}" +8`);
        }
      }

      // ── Bigrams (termos compostos) ────────────────────────────────────────
      const bigramMatches = this.scoring.checkBigramMatches(queryTokens, categoryTokens);
      if (bigramMatches > 0) {
        score += bigramMatches * 1.5;
        this.logger.debug(`🔗 ${bigramMatches} bigram(s) "${category.name}" +${bigramMatches * 1.5}`);
      }
      // Bigrams para subcategoria (mais valiosos)
      if (subCategoryTokens.length > 0) {
        const subBigramMatches = this.scoring.checkBigramMatches(queryTokens, subCategoryTokens);
        if (subBigramMatches > 0) {
          score += subBigramMatches * 2.5;
          this.logger.debug(`🔗 ${subBigramMatches} bigram(s) subcategoria +${subBigramMatches * 2.5}`);
        }
      }

      // ── Boost de sinônimo personalizado da conta ──────────────────────────
      const userSynonymMatch = userSynonyms.find((syn) => {
        if (syn.isGlobal) {
          const synCatNorm = this.textProcessing.normalize(syn.categoryName);
          const catNorm = this.textProcessing.normalize(category.name);
          const categoryMatches = synCatNorm === catNorm;
          if (syn.subCategoryName && category.subCategory?.name) {
            const synSubNorm = this.textProcessing.normalize(syn.subCategoryName);
            const subNorm = this.textProcessing.normalize(category.subCategory.name);
            return categoryMatches && synSubNorm === subNorm;
          }
          return categoryMatches;
        } else {
          return (
            syn.categoryId === category.id &&
            (!syn.subCategoryId || syn.subCategoryId === category.subCategory?.id)
          );
        }
      });

      if (userSynonymMatch) {
        const isSubcategoryMatch = userSynonymMatch.subCategoryName && category.subCategory?.name;
        const baseBoost = isSubcategoryMatch ? 5.0 : 3.0;
        const boost = baseBoost * userSynonymMatch.confidence;
        score += boost;
        const type = userSynonymMatch.isGlobal ? 'GLOBAL' : 'CONTA';
        this.logger.log(
          `🎯 Sinônimo ${type}: "${userSynonymMatch.keyword}" → "${category.name}" +${boost.toFixed(2)}`,
        );
      }

      // ── Boosts padrão (exact/startsWith) ─────────────────────────────────
      if (normalizedQuery === normalizedCategory) {
        score *= finalConfig.boostExactMatch;
      } else if (normalizedCategory.startsWith(normalizedQuery)) {
        score *= finalConfig.boostStartsWith;
      }

      // ── Sinônimos estáticos do dicionário ─────────────────────────────────
      const synonymScore = this.scoring.checkSynonyms(queryTokens, categoryTokens);
      if (synonymScore > 0) {
        score += synonymScore * 0.8;
      }

      if (subCategoryTokens.length > 0) {
        const subSynonymScore = this.scoring.checkSynonyms(queryTokens, subCategoryTokens);
        if (subSynonymScore > 0) {
          score += subSynonymScore * 3.5;
        }

        // Palavra exata da query que é token da subcategoria
        const exactSubCatMatch = queryTokens.some((qt) => subCategoryTokens.includes(qt));
        if (exactSubCatMatch) {
          score += 2.5;
        }
      }

      if (score >= finalConfig.minScore) {
        matches.push({
          categoryId: category.id,
          categoryName: category.name,
          subCategoryId: category.subCategory?.id,
          subCategoryName: category.subCategory?.name,
          score,
          matchedTerms: this.scoring.findMatchedTerms(queryTokens, categoryTokens),
        });
      }
    }

    // 7. Ordenar e limitar
    matches.sort((a, b) => b.score - a.score);
    const results = matches.slice(0, finalConfig.maxResults);
    const responseTime = Date.now() - startTime;

    // 8. Normalizar scores com quality gate
    if (results.length > 0 && results[0].score > 0) {
      const maxRawScore = results[0].score;
      const qualityFactor = Math.min(1.0, maxRawScore / 1.0);
      results.forEach((m) => {
        m.score = (m.score / maxRawScore) * qualityFactor;
      });
    }

    this.logger.log(
      `✅ ${results.length} categorias similares:` +
        results.map((m) => ` "${m.categoryName}" (${(m.score * 100).toFixed(1)}%)`).join(','),
    );

    // 9. Analytics fire-and-forget — não bloqueia resposta
    if (!skipLogging) {
      const success = results.length > 0 && results[0].score >= finalConfig.minScore;
      void this.analytics.record(userId, text, results, success, finalConfig.minScore, 'BM25', responseTime);
    }

    return results;
  }

  // ─────────────────────────── Vetorial (embeddings) ───────────────────────

  /**
   * Busca por similaridade de cosseno usando embeddings de IA.
   * Fallback automático para BM25 em caso de erro.
   *
   * @param accountId - Isola cache por conta (n:m obrigatório).
   */
  async findSimilarCategoriesWithEmbeddings(
    text: string,
    userId: string,
    aiProvider: any,
    config: Partial<RAGConfig> & { accountId: string } = {} as any,
  ): Promise<CategoryMatch[]> {
    const startTime = Date.now();
    const { accountId, ...configRest } = config;
    const finalConfig = { ...this.defaultConfig, ...configRest };

    try {
      // Carregar categorias do cache isolado por conta
      const categories = await this.ragCache.get(userId, accountId);

      if (categories.length === 0) {
        this.logger.warn(`⚠️ Nenhuma categoria no cache (embeddings) | accountId=${accountId}`);
        return [];
      }

      this.logger.debug(`🔍 [Embeddings] Gerando embedding para: "${text}"`);
      const queryEmbedding = await aiProvider.generateEmbedding(text);

      const matches: CategoryMatch[] = [];

      for (const category of categories) {
        if (!category.embedding) continue;

        const score = this.scoring.cosineSimilarity(queryEmbedding, category.embedding);

        if (score >= finalConfig.minScore) {
          matches.push({
            categoryId: category.id,
            categoryName: category.name,
            subCategoryId: category.subCategory?.id,
            subCategoryName: category.subCategory?.name,
            score: Math.min(score, 1.0),
            matchedTerms: ['[embedding match]'],
          });
        }
      }

      matches.sort((a, b) => b.score - a.score);
      const results = matches.slice(0, finalConfig.maxResults);
      const responseTime = Date.now() - startTime;

      this.logger.log(
        `✅ [Embeddings] ${results.length} categorias em ${responseTime}ms:` +
          results.map((m) => ` "${m.categoryName}" (${(m.score * 100).toFixed(1)}%)`).join(','),
      );

      const success = results.length > 0 && results[0].score >= finalConfig.minScore;
      void this.analytics.record(userId, text, results, success, finalConfig.minScore, 'AI', responseTime);

      return results;
    } catch (error) {
      this.logger.error('Erro na busca vetorial, fallback para BM25:', error);
      return this.findSimilarCategories(text, userId, { ...config, accountId });
    }
  }

  // ─────────────────────────── Detecção de termos ──────────────────────────

  /**
   * Detecta se um termo da mensagem é desconhecido e sugere aprendizado.
   *
   * @param accountId - Isola categorias e sinônimos por conta.
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
    try {
      const categories = await this.ragCache.get(userId, accountId);
      if (categories.length === 0) {
        this.logger.warn(`⚠️ [detectUnknownTerm] Sem categorias | userId=${userId} accountId=${accountId}`);
        return null;
      }

      const normalized = this.textProcessing.normalize(text);
      const tokens = this.textProcessing.tokenize(normalized);

      // Busca interna sem salvar log (já foi salvo no fluxo principal)
      const matches = await this.findSimilarCategories(text, userId, {
        maxResults: 3,
        minScore: 0.25,
        skipLogging: true,
        accountId,
      });

      if (matches.length === 0) return null;

      const bestMatch = matches[0];
      const isGenericCategory =
        bestMatch.categoryName === 'Outros' || bestMatch.categoryName === 'Geral';
      const isGenericSubcategory =
        !bestMatch.subCategoryName ||
        bestMatch.subCategoryName === 'Outros' ||
        bestMatch.subCategoryName === 'Geral';
      const isLowConfidence = bestMatch.score < 0.65;

      const hasExactSubcategoryMatch = tokens.some((token) => {
        if (!bestMatch.subCategoryName) return false;
        const normalizedSub = this.textProcessing.normalize(bestMatch.subCategoryName);
        return normalizedSub.includes(token) || token.includes(normalizedSub);
      });

      const filteredTokens = tokens.filter(
        (t) => !FILTER_WORDS_FOR_TERM_DETECTION.includes(t) && !/^\d+$/.test(t),
      );

      const detectedTerm = this.textProcessing.extractMainTerm(filteredTokens, categories);

      this.logger.debug(
        `🎯 [detectUnknownTerm] isGeneric=${isGenericCategory || isGenericSubcategory} ` +
          `isLowConfidence=${isLowConfidence} exactSub=${hasExactSubcategoryMatch} term="${detectedTerm}"`,
      );

      const needsLearning =
        (isGenericCategory || isGenericSubcategory || isLowConfidence) &&
        !hasExactSubcategoryMatch &&
        detectedTerm;

      if (!needsLearning) {
        return {
          detectedTerm: detectedTerm || tokens[0],
          isKnownSubcategory: true,
          suggestedCategory: bestMatch.categoryName,
          suggestedCategoryId: bestMatch.categoryId,
          suggestedSubcategory: bestMatch.subCategoryName,
          suggestedSubcategoryId: bestMatch.subCategoryId,
          confidence: bestMatch.score,
          reason: 'Match exato encontrado',
        };
      }

      const reason =
        isGenericCategory || isGenericSubcategory
          ? `Categoria genérica: "${bestMatch.categoryName} > ${bestMatch.subCategoryName || 'Outros'}"`
          : isLowConfidence
            ? `Score baixo (${(bestMatch.score * 100).toFixed(1)}%) para "${detectedTerm}"`
            : `"${detectedTerm}" não é subcategoria conhecida`;

      this.logger.log(`🎓 Sugerindo aprendizado: "${detectedTerm}" → ${reason}`);

      return {
        detectedTerm,
        isKnownSubcategory: false,
        suggestedCategory: bestMatch.categoryName,
        suggestedCategoryId: bestMatch.categoryId,
        suggestedSubcategory: bestMatch.subCategoryName,
        suggestedSubcategoryId: bestMatch.subCategoryId,
        confidence: bestMatch.score,
        reason: `${reason}. Sugerindo "${bestMatch.subCategoryName || 'Outros'}" em "${bestMatch.categoryName}"`,
      };
    } catch (error) {
      this.logger.error('Erro ao detectar termo desconhecido:', error);
      return null;
    }
  }

  // ─────────────────────────── Utilitários ─────────────────────────────────

  /**
   * Retorna categorias do cache (útil para resolução de IDs pós-match).
   */
  async getCachedCategories(userId: string, accountId?: string | null): Promise<UserCategory[]> {
    return this.ragCache.get(userId, accountId);
  }
}
