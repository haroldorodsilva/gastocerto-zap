import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@core/database/prisma.service';
import { CategoryMatch, RAGConfig, UserCategory } from './rag.interface';

/**
 * RAGService - Retrieval-Augmented Generation
 *
 * Implementação BM25 para matching semântico de categorias SEM embeddings vetoriais.
 *
 * FEATURES:
 * - Tokenização e normalização de texto (lowercase, remove acentos)
 * - Matching fuzzy com sinônimos
 * - Scoring BM25: term frequency (TF) + inverse document frequency (IDF)
 * - Cache de categorias por usuário
 * - Sem dependências externas (OpenAI, pgvector, etc)
 * - ✨ Log de tentativas no banco para analytics
 *
 * EXEMPLOS:
 * - "rotativo" → "Cartão Rotativo" (score: 0.95)
 * - "almoço" → "Alimentação > Restaurantes" (score: 0.75)
 * - "gasolina" → "Transporte > Combustível" (score: 0.88)
 */
@Injectable()
export class RAGService {
  private readonly logger = new Logger(RAGService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Cache de categorias por usuário (em memória - poderia ser Redis)
  // Chave: userId (gastoCertoId do UserCache)
  private readonly categoryCache = new Map<string, UserCategory[]>();

  // Dicionário de sinônimos para melhorar matching
  private readonly synonyms = new Map<string, string[]>([
    ['rotativo', ['cartao', 'credito', 'fatura', 'parcelado']],
    ['almoco', ['almoço', 'comida', 'restaurante', 'refeicao', 'alimento']],
    ['jantar', ['janta', 'comida', 'restaurante', 'refeicao']],
    ['gasolina', ['combustivel', 'posto', 'abastecimento', 'gas']],
    ['combustivel', ['gasolina', 'posto', 'abastecimento', 'gas']],
    ['supermercado', ['mercado', 'compras', 'alimentacao', 'feira']],
    ['mercado', ['supermercado', 'compras', 'alimentacao', 'feira']],
    ['farmacia', ['remedio', 'medicamento', 'drogaria', 'saude']],
    ['uber', ['taxi', 'transporte', '99', 'corrida', 'app']],
    ['ifood', ['delivery', 'entrega', 'comida', 'pedido']],
    ['netflix', ['streaming', 'assinatura', 'filme', 'serie']],
    ['academia', ['gym', 'ginastica', 'treino', 'musculacao']],
    ['aluguel', ['moradia', 'casa', 'apartamento', 'imovel']],
    ['agua', ['conta', 'saneamento', 'abastecimento']],
    ['luz', ['energia', 'eletricidade', 'conta']],
    ['internet', ['wifi', 'banda larga', 'provedor']],
    ['restaurante', ['comida', 'refeicao', 'almoco', 'jantar']],
    ['restaurantes', ['comida', 'refeicao', 'almoco', 'jantar']],
  ]);

  private readonly defaultConfig: RAGConfig = {
    minScore: 0.6,
    maxResults: 3,
    boostExactMatch: 2.0,
    boostStartsWith: 1.5,
  };

  /**
   * Indexa categorias do usuário no cache
   */
  async indexUserCategories(userId: string, categories: UserCategory[]): Promise<void> {
    this.logger.log(`📚 Indexando ${categories.length} categorias para usuário ${userId}`);
    this.categoryCache.set(userId, categories);
  }

  /**
   * Busca categorias similares usando BM25
   */
  async findSimilarCategories(
    text: string,
    userId: string,
    config: Partial<RAGConfig> = {},
  ): Promise<CategoryMatch[]> {
    const startTime = Date.now();
    const finalConfig = { ...this.defaultConfig, ...config };

    // Buscar categorias do cache
    const categories = this.categoryCache.get(userId) || [];
    if (categories.length === 0) {
      this.logger.warn(`⚠️ Nenhuma categoria indexada para usuário ${userId}`);
      return [];
    }

    // Normalizar texto de busca
    const normalizedQuery = this.normalize(text);
    const queryTokens = this.tokenize(normalizedQuery);

    this.logger.debug(`🔍 Buscando por: "${text}" → tokens: [${queryTokens.join(', ')}]`);

    // Calcular score para cada categoria
    const matches: CategoryMatch[] = [];

    for (const category of categories) {
      const categoryText = `${category.name} ${category.subCategory?.name || ''}`;
      const normalizedCategory = this.normalize(categoryText);
      const categoryTokens = this.tokenize(normalizedCategory);

      // Calcular similaridade BM25
      let score = this.calculateBM25Score(queryTokens, categoryTokens);

      // Aplicar boosts
      if (normalizedQuery === normalizedCategory) {
        score *= finalConfig.boostExactMatch;
        this.logger.debug(
          `✅ Match exato: "${category.name}" (boost ${finalConfig.boostExactMatch}x)`,
        );
      } else if (normalizedCategory.startsWith(normalizedQuery)) {
        score *= finalConfig.boostStartsWith;
        this.logger.debug(
          `✅ Começa com: "${category.name}" (boost ${finalConfig.boostStartsWith}x)`,
        );
      }

      // Verificar sinônimos
      const synonymScore = this.checkSynonyms(queryTokens, categoryTokens);
      if (synonymScore > 0) {
        score += synonymScore * 0.5; // Sinônimos valem 50%
        this.logger.debug(`🔄 Sinônimos encontrados: +${(synonymScore * 0.5).toFixed(2)}`);
      }

      // Normalizar score para 0-1
      score = Math.min(score, 1.0);

      if (score >= finalConfig.minScore) {
        matches.push({
          categoryId: category.id,
          categoryName: category.name,
          subCategoryId: category.subCategory?.id,
          subCategoryName: category.subCategory?.name,
          score,
          matchedTerms: this.findMatchedTerms(queryTokens, categoryTokens),
        });
      }
    }

    // Ordenar por score (maior primeiro)
    matches.sort((a, b) => b.score - a.score);

    // Limitar resultados
    const results = matches.slice(0, finalConfig.maxResults);
    const responseTime = Date.now() - startTime;

    this.logger.log(
      `✅ Encontradas ${results.length} categorias similares:` +
        results.map((m) => ` "${m.categoryName}" (${(m.score * 100).toFixed(1)}%)`).join(','),
    );

    // Registrar tentativa para analytics (banco de dados)
    const success = results.length > 0 && results[0].score >= finalConfig.minScore;
    await this.recordSearchAttempt(
      userId,
      text,
      results,
      success,
      finalConfig.minScore,
      'BM25', // Por enquanto sempre BM25, depois terá AI
      responseTime,
    );

    return results;
  }

  /**
   * Limpa cache de categorias (útil para testes)
   */
  clearCache(userId?: string): void {
    if (userId) {
      this.categoryCache.delete(userId);
      this.logger.debug(`🗑️ Cache limpo para usuário ${userId}`);
    } else {
      this.categoryCache.clear();
      this.logger.debug(`🗑️ Todo cache limpo`);
    }
  }

  /**
   * Registra tentativa de busca para analytics
   */
  private async recordSearchAttempt(
    userId: string,
    query: string,
    matches: CategoryMatch[],
    success: boolean,
    threshold: number,
    ragMode: string,
    responseTime: number,
  ): Promise<void> {
    try {
      // Salvar no banco de dados
      await this.prisma.rAGSearchLog.create({
        data: {
          userId,
          query,
          queryNormalized: this.normalize(query),
          matches: matches as any,
          bestMatch: matches.length > 0 ? matches[0].categoryName : null,
          bestScore: matches.length > 0 ? matches[0].score : null,
          threshold,
          success,
          ragMode,
          responseTime,
        },
      });

      this.logger.debug(
        `📊 RAG log salvo: userId=${userId}, query="${query}", success=${success}`,
      );
    } catch (error) {
      // Não lançar erro - logging não deve quebrar fluxo
      this.logger.warn(`Erro ao salvar log RAG:`, error);
    }
  }

  /**
   * Retorna tentativas de busca para analytics
   * Útil para identificar queries que não deram match
   */
  async getSearchAttempts(
    userId?: string,
    failedOnly: boolean = false,
  ): Promise<
    Array<{
      id: string;
      userId: string;
      query: string;
      bestMatch: string | null;
      bestScore: number | null;
      success: boolean;
      createdAt: Date;
    }>
  > {
    const where: any = {};

    if (userId) {
      where.userId = userId;
    }

    if (failedOnly) {
      where.success = false;
    }

    const logs = await this.prisma.rAGSearchLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100, // Últimas 100 tentativas
      select: {
        id: true,
        userId: true,
        query: true,
        bestMatch: true,
        bestScore: true,
        success: true,
        createdAt: true,
      },
    });

    return logs.map((log) => ({
      ...log,
      bestScore: log.bestScore ? Number(log.bestScore) : null,
    }));
  }

  /**
   * Normaliza texto: lowercase, remove acentos, trim
   */
  private normalize(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove acentos
      .replace(/[^\w\s]/g, ' ') // Remove pontuação
      .trim();
  }

  /**
   * Tokeniza texto em palavras
   */
  private tokenize(text: string): string[] {
    return text.split(/\s+/).filter((token) => token.length > 2); // Ignora tokens muito curtos
  }

  /**
   * Calcula score BM25 simplificado
   *
   * BM25 = Σ(IDF * TF * boost)
   * - TF (Term Frequency): quantas vezes o termo aparece
   * - IDF (Inverse Document Frequency): raridade do termo
   * - boost: relevância baseada em posição/contexto
   */
  private calculateBM25Score(queryTokens: string[], docTokens: string[]): number {
    let score = 0;
    const docLength = docTokens.length;
    const avgDocLength = 3; // Média de tokens em categorias (estimativa)
    const k1 = 1.2; // Parâmetro BM25
    const b = 0.75; // Parâmetro BM25

    for (const queryToken of queryTokens) {
      // Term Frequency (TF)
      const tf = docTokens.filter((t) => t === queryToken).length;

      if (tf > 0) {
        // IDF simplificado (assumindo corpus pequeno)
        const idf = 1.0;

        // BM25 formula
        const numerator = tf * (k1 + 1);
        const denominator = tf + k1 * (1 - b + b * (docLength / avgDocLength));

        score += idf * (numerator / denominator);
      }
    }

    // Normalizar pelo número de query tokens
    return queryTokens.length > 0 ? score / queryTokens.length : 0;
  }

  /**
   * Verifica se há sinônimos entre query e documento
   */
  private checkSynonyms(queryTokens: string[], docTokens: string[]): number {
    let synonymMatches = 0;

    for (const queryToken of queryTokens) {
      const synonyms = this.synonyms.get(queryToken) || [];

      for (const docToken of docTokens) {
        if (synonyms.includes(docToken)) {
          synonymMatches++;
        }

        // Verificar sinônimos reversos (docToken → queryToken)
        const reverseSynonyms = this.synonyms.get(docToken) || [];
        if (reverseSynonyms.includes(queryToken)) {
          synonymMatches++;
        }
      }
    }

    return synonymMatches > 0 ? synonymMatches / queryTokens.length : 0;
  }

  /**
   * Encontra termos que deram match
   */
  private findMatchedTerms(queryTokens: string[], docTokens: string[]): string[] {
    const matched: string[] = [];

    for (const queryToken of queryTokens) {
      if (docTokens.includes(queryToken)) {
        matched.push(queryToken);
      }

      // Verificar sinônimos
      const synonyms = this.synonyms.get(queryToken) || [];
      for (const docToken of docTokens) {
        if (synonyms.includes(docToken)) {
          matched.push(`${queryToken}→${docToken}`);
        }
      }
    }

    return matched;
  }
}
