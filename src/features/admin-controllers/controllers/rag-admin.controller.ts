import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { RAGService } from '@infrastructure/rag/services/rag.service';
import { RAGLearningService } from '@infrastructure/rag/services/rag-learning.service';
import { PrismaService } from '@core/database/prisma.service';
import { GastoCertoApiService } from '@shared/gasto-certo-api.service';
import { expandCategoriesForRAG } from '@features/users/user-cache.service';

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
  private readonly logger = new Logger(RagAdminController.name);

  constructor(
    private readonly ragService: RAGService,
    private readonly ragLearningService: RAGLearningService,
    private readonly prisma: PrismaService,
    private readonly gastoCertoApiService: GastoCertoApiService,
  ) {}

  /**
   * Testa o matching RAG para um usuário específico SEM criar logs
   * Útil para simular processamento e analisar resultados
   *
   * POST /admin/rag/test-match
   * Body: { userId: string, query: string, accountId?: string }
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
  async testMatch(@Body() body: { userId: string; query: string; accountId?: string }): Promise<{
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
    const { userId, query, accountId } = body;
    const startTime = Date.now();

    this.logger.log(`🔍 [TEST-MATCH] Iniciando teste para userId: ${userId}`);
    this.logger.log(`💬 [TEST-MATCH] Query: "${query}"`);
    if (accountId) {
      this.logger.log(`🏦 [TEST-MATCH] AccountId especificado: ${accountId} (teste de perfil)`);
    }

    // Buscar categorias do usuário
    const userCache = await this.prisma.userCache.findUnique({
      where: { gastoCertoId: userId },
      select: {
        gastoCertoId: true,
        phoneNumber: true,
        name: true,
        activeAccountId: true,
      },
    });

    if (!userCache) {
      this.logger.error(`❌ [TEST-MATCH] Usuário ${userId} não encontrado no cache`);
      throw new Error(`Usuário ${userId} não encontrado no cache`);
    }

    this.logger.log(
      `✅ [TEST-MATCH] Usuário encontrado: ${userCache.name} (${userCache.phoneNumber})`,
    );
    this.logger.log(
      `🏪 [TEST-MATCH] ActiveAccountId: ${userCache.activeAccountId || 'Não definido'}`,
    );

    // Buscar sinônimos personalizados do usuário E globais
    const userSynonyms = await this.prisma.userSynonym.findMany({
      where: {
        OR: [
          { userId: userCache.gastoCertoId }, // Sinônimos do usuário
          { userId: null }, // Sinônimos globais
        ],
      },
      orderBy: [
        { userId: 'asc' }, // Prioriza usuário sobre globais
        { confidence: 'desc' },
      ],
    });

    const personalSynonyms = userSynonyms.filter((s) => s.userId === userCache.gastoCertoId);
    const globalSynonyms = userSynonyms.filter((s) => s.userId === null);

    this.logger.log(
      `📚 [TEST-MATCH] Sinônimos encontrados: ${personalSynonyms.length} pessoais + ${globalSynonyms.length} globais`,
    );

    // 🔥 INDEXAR CATEGORIAS (igual ao fluxo de mensagens)
    this.logger.log(`📦 [TEST-MATCH] Buscando e indexando categorias...`);

    try {
      // Buscar categorias da API (todas as contas)
      const categoriesResponse = await this.gastoCertoApiService.getUserCategories(
        userCache.gastoCertoId,
      );

      if (categoriesResponse?.accounts?.length > 0) {
        // Usar accountId fornecido para teste, ou fallback para activeAccountId
        const targetAccountId = accountId || userCache.activeAccountId;

        // Encontrar a conta especificada (para teste) ou a conta ativa (default)
        const targetAccount = categoriesResponse.accounts.find((acc) => acc.id === targetAccountId);

        if (targetAccount && targetAccount.categories.length > 0) {
          // Expandir categorias (criar entrada para cada subcategoria)
          const userCategories = expandCategoriesForRAG(targetAccount.categories);

          // Indexar no Redis
          await this.ragService.indexUserCategories(userCache.gastoCertoId, userCategories);

          this.logger.log(
            `✅ [TEST-MATCH] ${userCategories.length} categorias indexadas no Redis (conta: ${targetAccount.name})`,
          );
          if (accountId) {
            this.logger.log(
              `🧪 [TEST-MATCH] MODO TESTE: Usando categorias do perfil "${targetAccount.name}" (não alterará dados do usuário)`,
            );
          }
        } else {
          this.logger.warn(
            `⚠️ [TEST-MATCH] Conta não encontrada ou sem categorias (accountId: ${targetAccountId})`,
          );
        }
      } else {
        this.logger.warn(`⚠️ [TEST-MATCH] Nenhuma conta encontrada para o usuário`);
      }
    } catch (indexError) {
      this.logger.error(`❌ [TEST-MATCH] Erro ao indexar categorias:`, indexError);
    }

    // Normalizar query e tokenizar
    const queryNormalized = this.ragService['normalize'](query);
    const queryTokens = this.ragService['tokenize'](queryNormalized);

    this.logger.log(`🧬 [TEST-MATCH] Query normalizada: "${queryNormalized}"`);
    this.logger.log(`🔠 [TEST-MATCH] Tokens: [${queryTokens.join(', ')}]`);

    // Buscar TODAS as categorias indexadas do usuário
    const cacheKey = `rag:categories:${userCache.gastoCertoId}`;
    const redisClient = await this.ragService['cacheManager'].get<string>(cacheKey);
    const allCategories = redisClient ? JSON.parse(redisClient) : [];

    this.logger.log(`📁 [TEST-MATCH] Categorias indexadas no Redis: ${allCategories.length}`);
    if (allCategories.length === 0) {
      this.logger.warn(`⚠️ [TEST-MATCH] NENHUMA categoria indexada para o usuário!`);
      this.logger.warn(`⚠️ [TEST-MATCH] Cache key: ${cacheKey}`);
    }

    // Executar matching SEM criar logs (threshold padrão)
    this.logger.log(`🎯 [TEST-MATCH] Executando matching RAG...`);
    const result = await this.ragService.findSimilarCategories(query, userCache.gastoCertoId, {
      skipLogging: true,
    });

    this.logger.log(
      `📊 [TEST-MATCH] Resultado do matching: ${result.length} match(es) encontrado(s)`,
    );
    if (result.length > 0) {
      this.logger.log(
        `🥇 [TEST-MATCH] Melhor match: "${result[0].categoryName}" (score: ${result[0].score})`,
      );
    }

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
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        ({ matchedTokens, ...rest }: { matchedTokens: any }) => rest,
      );
    }

    // Gerar sugestões baseadas no resultado
    const suggestions = this.generateSuggestions(result, query);

    // Gerar body de exemplo para criar transação
    const bestMatch = result.length > 0 ? result[0] : null;

    this.logger.log(`🔨 [TEST-MATCH] Gerando transaction body...`);
    if (bestMatch) {
      this.logger.log(
        `✅ [TEST-MATCH] Match encontrado - categoryId: ${bestMatch.categoryId}, subCategoryId: ${bestMatch.subCategoryId || 'null'}`,
      );
    } else {
      this.logger.warn(`⚠️ [TEST-MATCH] Nenhum match - transaction body sem categoria`);
    }

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

    this.logger.log(`⏱️ [TEST-MATCH] Tempo de processamento: ${processingTime}ms`);
    this.logger.log(`✅ [TEST-MATCH] Teste concluído com sucesso`);

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
   * Body: { userId: string, query: string, accountId?: string }
   *
   * Retorna lista ordenada por score de TODAS categorias
   */
  @Post('analyze')
  @HttpCode(HttpStatus.OK)
  async analyzeMatch(@Body() body: { userId: string; query: string; accountId?: string }): Promise<{
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
    const { userId, query, accountId } = body;

    this.logger.log(`🔬 [ANALYZE] Iniciando análise detalhada para userId: ${userId}`);
    if (accountId) {
      this.logger.log(`🏦 [ANALYZE] AccountId especificado: ${accountId} (teste de perfil)`);
    }

    const userCache = await this.prisma.userCache.findUnique({
      where: { gastoCertoId: userId },
      select: {
        gastoCertoId: true,
        activeAccountId: true,
      },
    });

    if (!userCache) {
      this.logger.error(`❌ [ANALYZE] Usuário ${userId} não encontrado no cache`);
      throw new BadRequestException(`Usuário ${userId} não encontrado no cache`);
    }

    // 🔥 INDEXAR CATEGORIAS (igual ao test-match)
    this.logger.log(`📦 [ANALYZE] Buscando e indexando categorias...`);

    try {
      const categoriesResponse = await this.gastoCertoApiService.getUserCategories(
        userCache.gastoCertoId,
      );

      if (categoriesResponse?.accounts?.length > 0) {
        // Usar accountId fornecido para teste, ou fallback para activeAccountId
        const targetAccountId = accountId || userCache.activeAccountId;

        // Encontrar a conta especificada (para teste) ou a conta ativa (default)
        const targetAccount = categoriesResponse.accounts.find((acc) => acc.id === targetAccountId);

        if (targetAccount && targetAccount.categories.length > 0) {
          const userCategories = expandCategoriesForRAG(targetAccount.categories);
          await this.ragService.indexUserCategories(userCache.gastoCertoId, userCategories);
          this.logger.log(
            `✅ [ANALYZE] ${userCategories.length} categorias indexadas (conta: ${targetAccount.name})`,
          );
          if (accountId) {
            this.logger.log(
              `🧪 [ANALYZE] MODO TESTE: Usando categorias do perfil "${targetAccount.name}" (não alterará dados do usuário)`,
            );
          }
        }
      }
    } catch (indexError) {
      this.logger.error(`❌ [ANALYZE] Erro ao indexar:`, indexError);
    }

    // Normalizar query
    const queryNormalized = this.ragService['normalize'](query);
    const queryTokens = this.ragService['tokenize'](queryNormalized);

    this.logger.log(`🔠 [ANALYZE] Tokens: [${queryTokens.join(', ')}]`);

    // Buscar categorias usando método do RAGService (igual test-match)
    const allCategories = await this.ragService.getCachedCategories(userCache.gastoCertoId);
    this.logger.log(`📁 [ANALYZE] Categorias para análise: ${allCategories.length}`);

    if (allCategories.length === 0) {
      this.logger.warn(`⚠️ [ANALYZE] Nenhuma categoria para analisar!`);
      return {
        query,
        queryNormalized,
        queryTokens,
        categories: [],
      };
    }

    // 🔥 USAR EXATAMENTE O MESMO RESULTADO que o test-match
    // Executar o RAG real para ter os resultados corretos
    const ragResults = await this.ragService.findSimilarCategories(query, userCache.gastoCertoId);

    // Criar um mapa dos resultados do RAG para acesso rápido
    const ragResultsMap = new Map();
    ragResults.forEach((result) => {
      const key = `${result.categoryId}:${result.subCategoryId || 'null'}`;
      ragResultsMap.set(key, result);
    });

    // Mapear todas as categorias mostrando os scores reais do RAG
    const categoriesWithScores = allCategories.map((cat) => {
      const key = `${cat.id}:${cat.subCategory?.id || 'null'}`;
      const ragResult = ragResultsMap.get(key);

      if (ragResult) {
        // Esta categoria teve match no RAG - usar score real
        const reasons: string[] = [];

        // Analisar como o score foi calculado
        const queryTokens = this.ragService['tokenize'](this.ragService['normalize'](query));
        const fullText = cat.subCategory?.name ? `${cat.name} ${cat.subCategory.name}` : cat.name;
        const normalizedText = this.ragService['normalize'](fullText);
        const categoryTokens = this.ragService['tokenize'](normalizedText);

        // Score BM25 base
        const bm25Score = this.ragService['calculateBM25Score'](queryTokens, categoryTokens);
        if (bm25Score > 0) {
          reasons.push(`BM25: ${bm25Score.toFixed(4)}`);
        }

        // Verificar word boundary matches
        if (cat.subCategory?.name) {
          const normalizedSubCat = this.ragService['normalize'](cat.subCategory.name);
          const subCatRegex = new RegExp(`\\b${normalizedSubCat}\\b`, 'i');
          if (
            normalizedSubCat.length >= 3 &&
            subCatRegex.test(this.ragService['normalize'](query))
          ) {
            reasons.push('Match direto: +10.0');
          }
        }

        // Verificar tokens individuais
        const matchingTokens = queryTokens.filter((qt) => categoryTokens.includes(qt));
        if (matchingTokens.length > 0) {
          const boost = matchingTokens.length * 2.0;
          reasons.push(`Tokens: [${matchingTokens.join(', ')}] (+${boost.toFixed(1)})`);
        }

        // All tokens match
        if (
          queryTokens.length > 0 &&
          queryTokens.every((token) => categoryTokens.includes(token))
        ) {
          reasons.push('All tokens: +8.0');
        }

        return {
          categoryId: cat.id,
          categoryName: cat.name,
          subCategoryId: cat.subCategory?.id,
          subCategoryName: cat.subCategory?.name,
          score: ragResult.score,
          matchedTokens: queryTokens.filter((qt) => categoryTokens.includes(qt)),
          reason:
            reasons.length > 0 ? reasons.join(' | ') : `Score RAG: ${ragResult.score.toFixed(4)}`,
        };
      } else {
        // Esta categoria não teve match no RAG
        return {
          categoryId: cat.id,
          categoryName: cat.name,
          subCategoryId: cat.subCategory?.id,
          subCategoryName: cat.subCategory?.name,
          score: 0,
          matchedTokens: [],
          reason: 'Sem match',
        };
      }
    });

    // Ordenar por score
    categoriesWithScores.sort((a, b) => b.score - a.score);

    // Pegar top 20
    const topCategories = categoriesWithScores.slice(0, 20);

    const topScore = categoriesWithScores[0]?.score || 0;
    const categoriesWithMatches = categoriesWithScores.filter((c) => c.score > 0).length;

    this.logger.log(
      `✅ [ANALYZE] Análise concluída - Top score: ${topScore.toFixed(4)} | ${categoriesWithMatches}/${allCategories.length} categorias com score > 0`,
    );

    // Buscar sinônimos para mostrar nas informações
    const userSynonyms = await this.prisma.userSynonym.findMany({
      where: {
        OR: [{ userId: userCache.gastoCertoId }, { userId: 'GLOBAL' }],
      },
    });

    const userSynCount = userSynonyms.filter((s) => s.userId === userCache.gastoCertoId).length;
    const globalSynCount = userSynonyms.filter((s) => s.userId === 'GLOBAL').length;

    this.logger.log(
      `📚 [ANALYZE] Sinônimos: ${userSynCount} do usuário + ${globalSynCount} globais = ${userSynonyms.length} total`,
    );

    if (categoriesWithMatches === 0) {
      this.logger.warn(`⚠️ [ANALYZE] Nenhuma categoria teve score > 0`);
      this.logger.log(`🔍 [ANALYZE] Primeiras 3 categorias disponíveis para debug:`);
      allCategories.slice(0, 3).forEach((cat, idx) => {
        const subCatText = cat.subCategory?.name ? ` > ${cat.subCategory.name}` : '';
        this.logger.log(`   ${idx + 1}. ${cat.name}${subCatText} (ID: ${cat.id})`);
      });
    }

    return {
      query,
      queryNormalized,
      queryTokens,
      categories: topCategories,
    };
  }

  /**
   * Cria sinônimo global (aplicado a todos os usuários)
   *
   * POST /admin/rag/synonym/global
   * Body: { keyword: string, categoryName: string, subCategoryName?: string }
   *
   * 💡 IMPORTANTE: Use NOMES de categorias, não IDs!
   * - Cada usuário tem IDs de categorias diferentes
   * - O matching é feito por nome da categoria/subcategoria
   *
   * Exemplo:
   * {
   *   "keyword": "uber",
   *   "categoryName": "Transporte",
   *   "subCategoryName": "Aplicativos"
   * }
   */
  @Post('synonym/global')
  @HttpCode(HttpStatus.CREATED)
  async createGlobalSynonym(
    @Body()
    body: {
      keyword: string;
      categoryName: string;
      subCategoryName?: string;
    },
  ): Promise<{ message: string; synonym: any }> {
    const { keyword, categoryName, subCategoryName } = body;

    if (!keyword || !categoryName) {
      throw new BadRequestException('keyword e categoryName são obrigatórios');
    }

    this.logger.log(
      `🌍 [GLOBAL-SYNONYM] Criando sinônimo global: "${keyword}" → ${categoryName}${subCategoryName ? ' > ' + subCategoryName : ''}`,
    );

    // Criar sinônimo com userId = null para aplicar a todos
    // Usa NOMES como referência, não IDs (cada usuário tem IDs diferentes)
    // categoryId/subCategoryId são opcionais - matching é feito por nome
    const synonym = await this.prisma.userSynonym.create({
      data: {
        userId: null,
        keyword: keyword.toLowerCase().trim(),
        categoryId: null, // Sinônimos globais não precisam de ID - matching é por nome
        categoryName: categoryName.trim(),
        subCategoryId: null,
        subCategoryName: subCategoryName?.trim() || null,
        confidence: 1.0,
        source: 'ADMIN_APPROVED',
      },
    });

    this.logger.log(`✅ [GLOBAL-SYNONYM] Sinônimo global criado: ID ${synonym.id}`);

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
      where: { gastoCertoId: userId },
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
      where: { gastoCertoId: userId },
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
   *
   * @param userId - gastoCertoId do usuário (UUID)
   */
  @Get('logs/:userId')
  async getUserLogs(
    @Param('userId') userId: string,
    @Query('failedOnly') failedOnly?: string,
    @Query('limit') limit?: string,
  ): Promise<any[]> {
    const userCache = await this.prisma.userCache.findUnique({
      where: { gastoCertoId: userId },
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

  // Métodos auxiliares para normalização e tokenização (implementação simples)
  private normalize(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove diacríticos
      .replace(/[^\w\s]/g, ' ')
      .trim();
  }

  private tokenize(text: string): string[] {
    return text
      .split(/\s+/)
      .filter((token) => token.length > 0)
      .map((token) => token.replace(/s$/, '')); // Remove plural simples
  }
}
