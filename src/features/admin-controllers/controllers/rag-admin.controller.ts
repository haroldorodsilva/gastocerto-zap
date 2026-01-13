import { Controller, Post, Get, Body, Param, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { RAGService } from '@infrastructure/rag/services/rag.service';
import { RAGLearningService } from '@infrastructure/rag/services/rag-learning.service';
import { PrismaService } from '@core/database/prisma.service';

/**
 * Controller Admin para testes e análise do sistema RAG
 *
 * Permite:
 * - Testar matching RAG sem criar logs
 * - Ver categorias consideradas no matching
 * - Analisar sugestões de sinônimos
 * - Gerenciar sinônimos globais e por usuário
 */
@Controller('admin/rag')
export class RagAdminController {
  constructor(
    private readonly ragService: RAGService,
    private readonly ragLearningService: RAGLearningService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Testa o matching RAG para um usuário específico SEM criar logs
   * Útil para simular processamento e analisar resultados
   *
   * POST /admin/rag/test-match
   * Body: { userId: string, query: string }
   *
   * Retorna:
   * - matches: categorias encontradas com scores
   * - suggestions: sugestões de categorias alternativas
   * - consideredCategories: todas categorias avaliadas no processo
   * - userSynonyms: sinônimos personalizados do usuário
   * - transactionBody: body pronto para criar transação na API
   * - debug: informações de debug do processamento
   */
  @Post('test-match')
  @HttpCode(HttpStatus.OK)
  async testMatch(@Body() body: { userId: string; query: string }): Promise<{
    matches: any[];
    suggestions: any[];
    userSynonyms: any[];
    transactionBody: any;
    debug: {
      processingTimeMs: number;
      userId: string;
      gastoCertoId: string;
      queryNormalized: string;
      queryTokens: string[];
      totalCategoriesIndexed: number;
      threshold: number;
      topNonMatchingCategories: Array<{
        category: string;
        subCategory?: string;
        score: number;
        reason: string;
      }>;
    };
  }> {
    const { userId, query } = body;
    const startTime = Date.now();

    // Buscar categorias do usuário
    const userCache = await this.prisma.userCache.findUnique({
      where: { id: userId },
      select: {
        gastoCertoId: true,
        phoneNumber: true,
        name: true,
        activeAccountId: true,
      },
    });

    if (!userCache) {
      throw new Error(`Usuário ${userId} não encontrado no cache`);
    }

    // Buscar sinônimos personalizados do usuário
    const userSynonyms = await this.prisma.userSynonym.findMany({
      where: { userId: userCache.gastoCertoId },
      orderBy: { confidence: 'desc' },
    });

    // Normalizar query e tokenizar
    const queryNormalized = this.ragService['normalize'](query);
    const queryTokens = this.ragService['tokenize'](queryNormalized);

    // Buscar TODAS as categorias indexadas do usuário
    const cacheKey = `rag:categories:${userCache.gastoCertoId}`;
    const redisClient = await this.ragService['cacheManager'].get<string>(cacheKey);
    const allCategories = redisClient ? JSON.parse(redisClient) : [];

    // Executar matching SEM criar logs (threshold padrão)
    const result = await this.ragService.findSimilarCategories(query, userCache.gastoCertoId, {
      skipLogging: true,
    });

    // Se não encontrou matches, calcular scores de TODAS as categorias para debug
    let topNonMatching: any[] = [];
    if (result.length === 0 && allCategories.length > 0) {
      const categoriesWithScores = allCategories
        .map((cat: any) => {
          const categoryText = `${cat.name} ${cat.subCategory?.name || ''}`.toLowerCase();
          const categoryTokens = categoryText.split(/\s+/).filter((t: string) => t.length > 0);

          // Calcular overlap simples
          const matchedTokens = queryTokens.filter((qt: string) =>
            categoryTokens.some((ct: string) => ct.includes(qt) || qt.includes(ct)),
          );
          const score = matchedTokens.length / Math.max(queryTokens.length, 1);

          let reason = 'Sem overlap de tokens';
          if (score > 0) {
            reason = `${matchedTokens.length} token(s) matched: ${matchedTokens.join(', ')}`;
          }

          return {
            category: cat.name,
            subCategory: cat.subCategory?.name,
            score: parseFloat(score.toFixed(4)),
            reason,
            matchedTokens,
          };
        })
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, 10); // Top 10 mais próximos

      topNonMatching = categoriesWithScores.map(
        ({ matchedTokens, ...rest }: { matchedTokens: any }) => rest,
      );
    }

    // Gerar sugestões baseadas no resultado
    const suggestions = this.generateSuggestions(result, query);

    // Gerar body de exemplo para criar transação
    const bestMatch = result.length > 0 ? result[0] : null;
    const transactionBody = bestMatch
      ? {
          userId: userCache.gastoCertoId,
          accountId: userCache.activeAccountId || '<ACCOUNT_ID_REQUIRED>',
          type: 'EXPENSES', // ou 'INCOME' - ajustar conforme necessário
          amount: 50.0, // Extrair do query ou definir manualmente
          categoryId: bestMatch.categoryId,
          subCategoryId: bestMatch.subCategoryId || null,
          description: query,
          date: new Date().toISOString().split('T')[0], // Formato YYYY-MM-DD
          source: 'telegram', // ou 'whatsapp' / 'webchat'
        }
      : {
          userId: userCache.gastoCertoId,
          accountId: userCache.activeAccountId || '<ACCOUNT_ID_REQUIRED>',
          type: 'EXPENSES',
          amount: 0,
          categoryId: null,
          subCategoryId: null,
          description: query,
          date: new Date().toISOString().split('T')[0],
          source: 'telegram',
          _warning: 'Nenhuma categoria encontrada. Defina categoryId manualmente.',
        };

    const processingTime = Date.now() - startTime;

    return {
      matches: result,
      suggestions,
      transactionBody,
      userSynonyms: userSynonyms.map((syn) => ({
        keyword: syn.keyword,
        categoryId: syn.categoryId,
        subCategoryId: syn.subCategoryId,
        confidence: syn.confidence,
        usageCount: syn.usageCount,
        createdAt: syn.createdAt,
      })),
      debug: {
        processingTimeMs: processingTime,
        userId: userId,
        gastoCertoId: userCache.gastoCertoId,
        queryNormalized,
        queryTokens,
        totalCategoriesIndexed: allCategories.length,
        threshold: 0.4, // Threshold padrão do RAG
        topNonMatchingCategories: topNonMatching,
      },
    };
  }

  /**
   * Retorna análise detalhada de como o RAG chegou ao resultado
   * Mostra scores de TODAS as categorias avaliadas
   *
   * POST /admin/rag/analyze
   * Body: { userId: string, query: string }
   *
   * Retorna lista ordenada por score de TODAS categorias
   */
  @Post('analyze')
  @HttpCode(HttpStatus.OK)
  async analyzeMatch(@Body() body: { userId: string; query: string }): Promise<{
    query: string;
    queryNormalized: string;
    queryTokens: string[];
    categories: Array<{
      categoryId: string;
      categoryName: string;
      subCategoryId?: string;
      subCategoryName?: string;
      score: number;
      matchedTokens: string[];
      reason: string;
    }>;
  }> {
    const { userId, query } = body;

    const userCache = await this.prisma.userCache.findUnique({
      where: { id: userId },
      select: { gastoCertoId: true },
    });

    if (!userCache) {
      throw new Error(`Usuário ${userId} não encontrado no cache`);
    }

    // Normalizar query
    const queryNormalized = this.ragService['normalize'](query);
    const queryTokens = this.ragService['tokenize'](queryNormalized);

    // Buscar todas categorias
    const allCategories = await this.ragService['getUserCategories'](userCache.gastoCertoId);

    // Calcular score para CADA categoria
    const categoriesWithScores = allCategories.map((cat) => {
      const categoryText = `${cat.name} ${cat.subCategory?.name || ''}`;
      const categoryNormalized = this.ragService['normalize'](categoryText);
      const categoryTokens = this.ragService['tokenize'](categoryNormalized);

      // Calcular score BM25
      const score = this.ragService['calculateBM25Score'](queryTokens, categoryTokens);

      // Verificar tokens que deram match
      const matchedTokens = queryTokens.filter((qt) => categoryTokens.includes(qt));

      // Determinar razão do score
      let reason = 'Sem match';
      if (score > 0.5) reason = 'Match forte';
      else if (score > 0.3) reason = 'Match médio';
      else if (score > 0.1) reason = 'Match fraco';

      return {
        categoryId: cat.id,
        categoryName: cat.name,
        subCategoryId: cat.subCategory?.id,
        subCategoryName: cat.subCategory?.name,
        score,
        matchedTokens,
        reason,
      };
    });

    // Ordenar por score (maior primeiro)
    categoriesWithScores.sort((a, b) => b.score - a.score);

    return {
      query,
      queryNormalized,
      queryTokens,
      categories: categoriesWithScores,
    };
  }

  /**
   * Cria sinônimo global (aplicado a todos os usuários)
   *
   * POST /admin/rag/synonym/global
   * Body: { keyword: string, categoryId: string, subCategoryId?: string }
   */
  @Post('synonym/global')
  @HttpCode(HttpStatus.CREATED)
  async createGlobalSynonym(
    @Body()
    body: {
      keyword: string;
      categoryId: string;
      subCategoryId?: string;
    },
  ): Promise<{ message: string; synonym: any }> {
    const { keyword, categoryId, subCategoryId } = body;

    // Criar sinônimo com userId = 'GLOBAL' para aplicar a todos
    const synonym = await this.prisma.userSynonym.create({
      data: {
        userId: 'GLOBAL',
        keyword: keyword.toLowerCase().trim(),
        categoryId,
        categoryName: categoryId, // TODO: Buscar nome real da categoria
        subCategoryId: subCategoryId || '',
        subCategoryName: subCategoryId || '',
        confidence: 1.0,
        source: 'ADMIN_APPROVED',
      },
    });

    // Limpar cache RAG para forçar reindexação
    await this.ragService.clearCache?.();

    return {
      message: 'Sinônimo global criado com sucesso',
      synonym,
    };
  }

  /**
   * Cria sinônimo para usuário específico
   *
   * POST /admin/rag/synonym/user
   * Body: { userId: string, keyword: string, categoryId: string, subCategoryId?: string }
   */
  @Post('synonym/user')
  @HttpCode(HttpStatus.CREATED)
  async createUserSynonym(
    @Body()
    body: {
      userId: string;
      keyword: string;
      categoryId: string;
      subCategoryId?: string;
    },
  ): Promise<{ message: string; synonym: any }> {
    const { userId, keyword, categoryId, subCategoryId } = body;

    // Buscar gastoCertoId do usuário
    const userCache = await this.prisma.userCache.findUnique({
      where: { id: userId },
      select: { gastoCertoId: true },
    });

    if (!userCache) {
      throw new Error(`Usuário ${userId} não encontrado no cache`);
    }

    // Criar sinônimo personalizado
    const synonym = await this.prisma.userSynonym.create({
      data: {
        userId: userCache.gastoCertoId,
        keyword: keyword.toLowerCase().trim(),
        categoryId,
        categoryName: categoryId, // TODO: Buscar nome real da categoria
        subCategoryId: subCategoryId || '',
        subCategoryName: subCategoryId || '',
        confidence: 0.9,
        source: 'ADMIN_APPROVED',
      },
    });

    return {
      message: 'Sinônimo criado com sucesso para o usuário',
      synonym,
    };
  }

  /**
   * Lista sinônimos de um usuário específico
   *
   * GET /admin/rag/synonyms/:userId
   */
  @Get('synonyms/:userId')
  async getUserSynonyms(@Param('userId') userId: string): Promise<any[]> {
    const userCache = await this.prisma.userCache.findUnique({
      where: { id: userId },
      select: { gastoCertoId: true },
    });

    if (!userCache) {
      throw new Error(`Usuário ${userId} não encontrado no cache`);
    }

    return await this.prisma.userSynonym.findMany({
      where: { userId: userCache.gastoCertoId },
      orderBy: { confidence: 'desc' },
    });
  }

  /**
   * Busca logs de tentativas RAG de um usuário
   * Útil para ver queries que não deram match
   *
   * GET /admin/rag/logs/:userId?failedOnly=true
   */
  @Get('logs/:userId')
  async getUserLogs(
    @Param('userId') userId: string,
    @Query('failedOnly') failedOnly?: string,
    @Query('limit') limit?: string,
  ): Promise<any[]> {
    const userCache = await this.prisma.userCache.findUnique({
      where: { id: userId },
      select: { gastoCertoId: true },
    });

    if (!userCache) {
      throw new Error(`Usuário ${userId} não encontrado no cache`);
    }

    const where: any = { userId: userCache.gastoCertoId };
    if (failedOnly === 'true') {
      where.success = false;
    }

    return await this.prisma.rAGSearchLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit ? parseInt(limit) : 50,
    });
  }

  /**
   * Gera sugestões de sinônimos baseado no matching
   */
  private generateSuggestions(matches: any[], query: string): any[] {
    const suggestions = [];

    // Se não teve match bom, sugerir análise manual
    if (matches.length === 0 || matches[0].score < 0.5) {
      suggestions.push({
        type: 'low_match',
        keyword: query,
        reason: 'Nenhum match forte encontrado - considere criar sinônimo',
        confidence: 0.5,
      });
    }

    // Se teve match mas score médio, sugerir criação de sinônimo
    if (matches.length > 0 && matches[0].score >= 0.3 && matches[0].score < 0.7) {
      suggestions.push({
        type: 'improve_match',
        keyword: query,
        categoryName: matches[0].categoryName,
        subCategoryName: matches[0].subCategoryName,
        reason: 'Match médio - criar sinônimo pode melhorar',
        confidence: 0.8,
      });
    }

    return suggestions;
  }
}
