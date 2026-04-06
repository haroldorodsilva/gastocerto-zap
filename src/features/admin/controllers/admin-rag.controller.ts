import {
  Controller,
  Post,
  Get,
  Delete,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
  Query,
  Param,
  Body,
  BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { PrismaService } from '@core/database/prisma.service';
import { RAGService } from '@infrastructure/rag/services/rag.service';
import { UserCacheService } from '../../users/user-cache.service';
import { GastoCertoApiService } from '@shared/gasto-certo-api.service';
import { expandCategoriesForRAG } from '@features/users/user-cache.service';

/**
 * AdminRagController — Consolidated RAG admin endpoints
 *
 * Endpoints:
 * - Logs & Stats: search-logs (list, detail, delete), user-logs, stats
 * - Testing: test-match, analyze
 * - Synonyms: global create, user create, user list
 *
 * Previously split across AdminRAGController + RagAdminController; merged for cohesion.
 */
@Controller('admin/rag')
@UseGuards(JwtAuthGuard)
export class AdminRagController {
  private readonly logger = new Logger(AdminRagController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ragService: RAGService,
    private readonly cacheService: UserCacheService,
    private readonly gastoCertoApiService: GastoCertoApiService,
  ) {}

  // ═══════════════════════════════════════════════════════════════
  //  LOGS & STATS
  // ═══════════════════════════════════════════════════════════════

  /**
   * GET /admin/rag/search-logs
   * Paginated RAG search logs enriched with userName, AI fallback stats, provider stats
   */
  @Get('search-logs')
  async getRagSearchLogs(
    @Query('userId') userId?: string,
    @Query('failedOnly') failedOnly?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    this.logger.log('Admin solicitou logs de busca RAG');

    try {
      const failedFilter = failedOnly === 'true';
      const limitNum = Math.min(parseInt(limit || '20'), 100);
      const offsetNum = parseInt(offset || '0');

      const result = await this.ragService.getSearchAttempts(
        userId || null,
        failedFilter,
        limitNum,
        offsetNum,
      );

      // Enriquecer logs com userName
      const enrichedLogs = await Promise.all(
        result.logs.map(async (log) => {
          const user = await this.cacheService.getUserByGastoCertoId(log.userId);
          return {
            ...log,
            userName: user?.name || 'Desconhecido',
          };
        }),
      );

      // Estatísticas da página
      const successfulAttempts = result.logs.filter((log) => log.success).length;
      const failedAttempts = result.logs.length - successfulAttempts;
      const successRate =
        result.logs.length > 0
          ? ((successfulAttempts / result.logs.length) * 100).toFixed(2)
          : '0.00';

      // Estatísticas de AI Fallback
      const logsWithDetails = await this.prisma.rAGSearchLog.findMany({
        where: {
          id: { in: result.logs.map((l) => l.id) },
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          query: true,
          success: true,
          wasAiFallback: true,
          flowStep: true,
          totalSteps: true,
          aiProvider: true,
          aiModel: true,
          ragMode: true,
          responseTime: true,
          createdAt: true,
        },
      });

      const aiFallbackCount = logsWithDetails.filter((log) => log.wasAiFallback).length;
      const aiFallbackRate =
        result.logs.length > 0 ? ((aiFallbackCount / result.logs.length) * 100).toFixed(2) : '0.00';

      // Top queries que falharam (página atual)
      const failedQueries = result.logs
        .filter((log) => !log.success)
        .reduce(
          (acc, log) => {
            acc[log.query] = (acc[log.query] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>,
        );

      const topFailedQueries = Object.entries(failedQueries)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 10)
        .map(([query, count]) => ({ query, count }));

      // Estatísticas por provider de AI
      const aiProviderStats = logsWithDetails
        .filter((log) => log.aiProvider)
        .reduce(
          (acc, log) => {
            const provider = log.aiProvider || 'unknown';
            if (!acc[provider]) {
              acc[provider] = { count: 0, models: new Set<string>() };
            }
            acc[provider].count++;
            if (log.aiModel) acc[provider].models.add(log.aiModel);
            return acc;
          },
          {} as Record<string, { count: number; models: Set<string> }>,
        );

      const providerSummary = Object.entries(aiProviderStats).map(([provider, data]) => ({
        provider,
        count: data.count,
        models: Array.from(data.models),
      }));

      return {
        success: true,
        data: enrichedLogs,
        pagination: {
          total: result.total,
          limit: result.limit,
          offset: result.offset,
          hasMore: result.offset + result.limit < result.total,
          pages: Math.ceil(result.total / result.limit),
          currentPage: Math.floor(result.offset / result.limit) + 1,
        },
        stats: {
          totalRecords: result.total,
          currentPageAttempts: result.logs.length,
          successfulAttempts,
          failedAttempts,
          successRate: `${successRate}%`,
          aiFallbackCount,
          aiFallbackRate: `${aiFallbackRate}%`,
          topFailedQueries,
          aiProviders: providerSummary,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      this.logger.error('Erro ao buscar logs RAG:', error);

      return {
        success: false,
        message: 'Erro ao buscar logs RAG',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * GET /admin/rag/search-logs/:id/details
   * Full detail of a single RAG log: user, transactions, AI logs, synonyms
   */
  @Get('search-logs/:id/details')
  async getRagSearchLogDetail(@Param('id') id: string) {
    this.logger.log(`Admin solicitou detalhes do log RAG: ${id}`);

    try {
      const log = await this.prisma.rAGSearchLog.findUnique({
        where: { id },
      });

      if (!log) {
        return {
          success: false,
          message: 'Log RAG não encontrado',
          timestamp: new Date().toISOString(),
        };
      }

      const user = await this.cacheService.getUserByGastoCertoId(log.userId);
      const userData = user
        ? {
            id: user.id,
            name: user.name,
            phoneNumber: user.phoneNumber,
            whatsappId: user.whatsappId,
            telegramId: user.telegramId,
            gastoCertoId: user.gastoCertoId,
            activeAccountId: user.activeAccountId,
            isActive: user.isActive,
            hasActiveSubscription: user.hasActiveSubscription,
            createdAt: user.createdAt,
          }
        : null;

      const transactions = await this.prisma.transactionConfirmation.findMany({
        where: {
          ragSearchLogId: id,
          deletedAt: null,
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      const aiLogs = await this.prisma.aIUsageLog.findMany({
        where: { ragSearchLogId: id },
        orderBy: { createdAt: 'asc' },
      });

      const userSynonyms = user
        ? await this.prisma.userSynonym.findMany({
            where: {
              userId: log.userId,
              keyword: {
                contains: log.queryNormalized,
              },
            },
            orderBy: { usageCount: 'desc' },
            take: 10,
          })
        : [];

      return {
        success: true,
        data: {
          ragLog: log,
          user: userData,
          transactions,
          aiUsageLogs: aiLogs,
          aiUsageStats: {
            totalLogs: aiLogs.length,
            totalTokens: aiLogs.reduce((sum, l) => sum + (l.totalTokens || 0), 0),
            totalCost: aiLogs.reduce(
              (sum, l) => sum + (l.estimatedCost ? Number(l.estimatedCost) : 0),
              0,
            ),
            providers: [...new Set(aiLogs.map((l) => l.provider))],
            models: [...new Set(aiLogs.map((l) => l.model))],
          },
          relatedSynonyms: userSynonyms,
          ragAnalysis: {
            wasSuccessful: log.success,
            usedAiFallback: log.wasAiFallback,
            ragMode: log.ragMode,
            ragInitialScore: log.ragInitialScore ? Number(log.ragInitialScore) : null,
            threshold: log.threshold ? Number(log.threshold) : null,
            passedThreshold:
              log.ragInitialScore && log.threshold
                ? Number(log.ragInitialScore) >= Number(log.threshold)
                : false,
            responseTimeMs: log.responseTime,
            flowStep: log.flowStep,
            totalSteps: log.totalSteps,
          },
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      this.logger.error('Erro ao buscar detalhes do log RAG:', error);

      return {
        success: false,
        message: 'Erro ao buscar detalhes do log RAG',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * GET /admin/rag/stats?year=2026&month=1
   * GET /admin/rag/stats?days=7
   *
   * Comprehensive RAG statistics: success rates, scores, top users/queries, AI costs
   */
  @Get('stats')
  async getRagStats(
    @Query('year') year?: string,
    @Query('month') month?: string,
    @Query('days') days?: string,
  ) {
    this.logger.log('Admin solicitou estatísticas do RAG');

    try {
      let startDate: Date;
      let endDate: Date;
      let periodLabel: string;

      if (year) {
        const yearNum = parseInt(year);

        if (month) {
          const monthNum = parseInt(month);
          startDate = new Date(yearNum, monthNum - 1, 1);
          endDate = new Date(yearNum, monthNum, 0, 23, 59, 59, 999);
          periodLabel = `${monthNum.toString().padStart(2, '0')}/${yearNum}`;
        } else {
          startDate = new Date(yearNum, 0, 1);
          endDate = new Date(yearNum, 11, 31, 23, 59, 59, 999);
          periodLabel = yearNum.toString();
        }
      } else {
        const daysNum = parseInt(days || '7');
        startDate = new Date();
        startDate.setDate(startDate.getDate() - daysNum);
        endDate = new Date();
        periodLabel = `Últimos ${daysNum} dias`;
      }

      const whereClause = {
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      };

      const totalSearches = await this.prisma.rAGSearchLog.count({
        where: whereClause,
      });

      const successfulSearches = await this.prisma.rAGSearchLog.count({
        where: { ...whereClause, success: true },
      });

      const aiFallbackSearches = await this.prisma.rAGSearchLog.count({
        where: { ...whereClause, wasAiFallback: true },
      });

      const avgScore = await this.prisma.rAGSearchLog.aggregate({
        where: whereClause,
        _avg: { ragInitialScore: true },
      });

      const avgResponseTime = await this.prisma.rAGSearchLog.aggregate({
        where: whereClause,
        _avg: { responseTime: true },
      });

      const topUsersRaw = await this.prisma.rAGSearchLog.groupBy({
        by: ['userId'],
        where: whereClause,
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      });

      const topUsers = await Promise.all(
        topUsersRaw.map(async (u) => {
          const user = await this.cacheService.getUserByGastoCertoId(u.userId);
          return {
            userId: u.userId,
            userName: user?.name || 'Desconhecido',
            searches: u._count.id,
          };
        }),
      );

      const needsSynonymLearning = await this.prisma.aIUsageLog.count({
        where: {
          createdAt: { gte: startDate, lte: endDate },
          needsSynonymLearning: true,
        },
      });

      const flowStepDistribution = await this.prisma.rAGSearchLog.groupBy({
        by: ['flowStep', 'totalSteps'],
        where: whereClause,
        _count: { id: true },
        orderBy: { flowStep: 'asc' },
      });

      const topQueriesRaw = await this.prisma.rAGSearchLog.groupBy({
        by: ['query'],
        where: whereClause,
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 20,
      });

      const topQueries = topQueriesRaw.map((q) => ({
        query: q.query,
        count: q._count.id,
      }));

      const topFailedQueriesRaw = await this.prisma.rAGSearchLog.groupBy({
        by: ['query'],
        where: { ...whereClause, success: false },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 20,
      });

      const topFailedQueries = topFailedQueriesRaw.map((q) => ({
        query: q.query,
        count: q._count.id,
      }));

      const topCategoriesRaw = await this.prisma.rAGSearchLog.groupBy({
        by: ['bestMatch'],
        where: { ...whereClause, success: true, bestMatch: { not: null } },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 20,
      });

      const topCategories = topCategoriesRaw.map((c) => ({
        category: c.bestMatch || 'Desconhecida',
        count: c._count.id,
      }));

      const ragModeDistribution = await this.prisma.rAGSearchLog.groupBy({
        by: ['ragMode'],
        where: whereClause,
        _count: { id: true },
      });

      const aiCosts = await this.prisma.aIUsageLog.aggregate({
        where: {
          createdAt: { gte: startDate, lte: endDate },
        },
        _sum: {
          totalTokens: true,
          estimatedCost: true,
        },
        _count: { id: true },
      });

      return {
        success: true,
        period: {
          label: periodLabel,
          from: startDate.toISOString(),
          to: endDate.toISOString(),
        },
        summary: {
          totalSearches,
          successfulSearches,
          failedSearches: totalSearches - successfulSearches,
          successRate:
            totalSearches > 0
              ? ((successfulSearches / totalSearches) * 100).toFixed(2) + '%'
              : '0%',
          aiFallbackSearches,
          aiFallbackRate:
            totalSearches > 0
              ? ((aiFallbackSearches / totalSearches) * 100).toFixed(2) + '%'
              : '0%',
          avgRagScore: avgScore._avg.ragInitialScore
            ? Number(avgScore._avg.ragInitialScore).toFixed(4)
            : null,
          avgResponseTimeMs: avgResponseTime._avg.responseTime
            ? Math.round(avgResponseTime._avg.responseTime)
            : null,
          needsSynonymLearning,
        },
        topUsers,
        topQueries,
        topFailedQueries,
        topCategories,
        flowStepDistribution: flowStepDistribution.map((d) => ({
          step: d.flowStep,
          totalSteps: d.totalSteps,
          label: `Step ${d.flowStep}/${d.totalSteps}`,
          count: d._count.id,
        })),
        ragModeDistribution: ragModeDistribution.map((r) => ({
          mode: r.ragMode,
          count: r._count.id,
        })),
        aiUsage: {
          totalLogs: aiCosts._count.id,
          totalTokens: aiCosts._sum.totalTokens || 0,
          totalCost: aiCosts._sum.estimatedCost ? Number(aiCosts._sum.estimatedCost) : 0,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      this.logger.error('Erro ao buscar estatísticas RAG:', error);

      return {
        success: false,
        message: 'Erro ao buscar estatísticas RAG',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * GET /admin/rag/user-logs/:userId?limit=50&onlyFailed=true
   * RAG logs for a specific user with user info and selected fields
   */
  @Get('user-logs/:userId')
  async getUserRagLogs(
    @Param('userId') userId: string,
    @Query('limit') limit?: string,
    @Query('onlyFailed') onlyFailed?: string,
  ) {
    this.logger.log(`Admin solicitou logs RAG do usuário: ${userId}`);

    try {
      const limitNum = Math.min(parseInt(limit || '50'), 200);
      const failedFilter = onlyFailed === 'true';

      const where: any = { userId };
      if (failedFilter) {
        where.success = false;
      }

      const logs = await this.prisma.rAGSearchLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limitNum,
        select: {
          id: true,
          query: true,
          queryNormalized: true,
          matches: true,
          bestMatch: true,
          bestScore: true,
          success: true,
          ragMode: true,
          wasAiFallback: true,
          flowStep: true,
          totalSteps: true,
          responseTime: true,
          createdAt: true,
        },
      });

      const user = await this.cacheService.getUser(userId);

      return {
        success: true,
        data: {
          user: user
            ? {
                id: user.id,
                name: user.name,
                phoneNumber: user.phoneNumber,
                gastoCertoId: user.gastoCertoId,
              }
            : null,
          logs,
          total: logs.length,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      this.logger.error('Erro ao buscar logs do usuário:', error);

      return {
        success: false,
        message: 'Erro ao buscar logs do usuário',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * DELETE /admin/rag/search-logs
   * Bulk delete RAG search logs by IDs
   */
  @Delete('search-logs')
  @HttpCode(HttpStatus.OK)
  async deleteRagSearchLogs(@Body() dto: { ids: string[] }) {
    this.logger.log(`Admin solicitou exclusão de ${dto.ids?.length || 0} logs RAG`);

    try {
      if (!dto.ids || !Array.isArray(dto.ids) || dto.ids.length === 0) {
        throw new BadRequestException('IDs são obrigatórios e devem ser um array não vazio');
      }

      const result = await this.ragService.deleteSearchLogs(dto.ids);

      this.logger.log(`Deletados ${result.deletedCount} de ${dto.ids.length} logs solicitados`);

      return {
        success: true,
        message: `${result.deletedCount} logs deletados com sucesso`,
        deletedCount: result.deletedCount,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      this.logger.error('Erro ao deletar logs RAG:', error);

      return {
        success: false,
        message: 'Erro ao deletar logs RAG',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  TESTING & ANALYSIS
  // ═══════════════════════════════════════════════════════════════

  /**
   * POST /admin/rag/test-match
   * Full RAG matching simulation with debug info, category indexing, suggestions
   * Body: { userId: string, query: string, accountId?: string }
   */
  @Post('test-match')
  @HttpCode(HttpStatus.OK)
  async testMatch(@Body() body: { userId: string; query: string; accountId?: string }) {
    const { userId, query, accountId } = body;
    const startTime = Date.now();

    this.logger.log(`[TEST-MATCH] Iniciando teste para userId: ${userId}, query: "${query}"`);

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
      throw new BadRequestException(`Usuário ${userId} não encontrado no cache`);
    }

    const targetAccountId = accountId || userCache.activeAccountId;

    // Buscar sinônimos da conta + globais
    const userSynonyms = await this.prisma.userSynonym.findMany({
      where: {
        OR: [
          { userId: userCache.gastoCertoId, accountId: targetAccountId || undefined },
          { userId: null, accountId: null },
        ],
      },
      orderBy: [{ userId: 'asc' }, { confidence: 'desc' }],
    });

    // Indexar categorias (igual ao fluxo de mensagens)
    if (targetAccountId) {
      try {
        const categoriesResponse = await this.gastoCertoApiService.getUserCategories(
          userCache.gastoCertoId,
        );

        if (categoriesResponse?.accounts?.length > 0) {
          const targetAccount = categoriesResponse.accounts.find((acc) => acc.id === targetAccountId);

          if (targetAccount && targetAccount.categories.length > 0) {
            const userCategories = expandCategoriesForRAG(targetAccount.categories);
            await this.ragService.indexUserCategories(userCache.gastoCertoId, userCategories, targetAccountId);
            this.logger.log(
              `[TEST-MATCH] ${userCategories.length} categorias indexadas (conta: ${targetAccount.name})`,
            );
          }
        }
      } catch (indexError) {
        this.logger.error('[TEST-MATCH] Erro ao indexar categorias:', indexError);
      }
    }

    // Normalizar query e tokenizar
    const queryNormalized = this.ragService.normalizeText(query);
    const queryTokens = this.ragService.tokenizeText(queryNormalized);

    // Buscar categorias indexadas
    const allCategories = targetAccountId
      ? await this.ragService.getCachedCategories(userCache.gastoCertoId, targetAccountId)
      : [];

    // Executar matching sem criar logs
    const result = targetAccountId
      ? await this.ragService.findSimilarCategories(query, userCache.gastoCertoId, {
          skipLogging: true,
          accountId: targetAccountId,
        })
      : [];

    // Debug: se sem matches, calcular top categorias mais próximas
    let topNonMatching: any[] = [];
    if (result.length === 0 && allCategories.length > 0) {
      topNonMatching = allCategories
        .map((cat: any) => {
          const categoryText = `${cat.name} ${cat.subCategory?.name || ''}`.toLowerCase();
          const categoryTokens = categoryText.split(/\s+/).filter((t: string) => t.length > 0);
          const matchedTokens = queryTokens.filter((qt: string) =>
            categoryTokens.some((ct: string) => ct.includes(qt) || qt.includes(ct)),
          );
          const score = matchedTokens.length / Math.max(queryTokens.length, 1);

          return {
            category: cat.name,
            subCategory: cat.subCategory?.name,
            score: parseFloat(score.toFixed(4)),
            reason:
              score > 0
                ? `${matchedTokens.length} token(s) matched: ${matchedTokens.join(', ')}`
                : 'Sem overlap de tokens',
          };
        })
        .sort((a: any, b: any) => b.score - a.score)
        .slice(0, 10);
    }

    // Sugestões baseadas no resultado
    const suggestions = this.generateSuggestions(result, query);

    // Body de exemplo para transação
    const bestMatch = result.length > 0 ? result[0] : null;
    const transactionBody = bestMatch
      ? {
          userId: userCache.gastoCertoId,
          accountId: userCache.activeAccountId || '<ACCOUNT_ID_REQUIRED>',
          type: 'EXPENSES',
          amount: 50.0,
          categoryId: bestMatch.categoryId,
          subCategoryId: bestMatch.subCategoryId || null,
          description: query,
          date: new Date().toISOString().split('T')[0],
          source: 'telegram',
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
        userId,
        gastoCertoId: userCache.gastoCertoId,
        queryNormalized,
        queryTokens,
        totalCategoriesIndexed: allCategories.length,
        threshold: 0.4,
        topNonMatchingCategories: topNonMatching,
      },
    };
  }

  /**
   * POST /admin/rag/analyze
   * Detailed score analysis of ALL categories for a query (BM25 breakdown)
   * Body: { userId: string, query: string, accountId?: string }
   */
  @Post('analyze')
  @HttpCode(HttpStatus.OK)
  async analyzeMatch(@Body() body: { userId: string; query: string; accountId?: string }) {
    const { userId, query, accountId } = body;

    this.logger.log(`[ANALYZE] Análise detalhada para userId: ${userId}`);

    const userCache = await this.prisma.userCache.findUnique({
      where: { gastoCertoId: userId },
      select: { gastoCertoId: true, activeAccountId: true },
    });

    if (!userCache) {
      throw new BadRequestException(`Usuário ${userId} não encontrado no cache`);
    }

    const targetAccountId = accountId || userCache.activeAccountId;

    // Indexar categorias
    if (targetAccountId) {
      try {
        const categoriesResponse = await this.gastoCertoApiService.getUserCategories(
          userCache.gastoCertoId,
        );

        if (categoriesResponse?.accounts?.length > 0) {
          const targetAccount = categoriesResponse.accounts.find((acc) => acc.id === targetAccountId);

          if (targetAccount && targetAccount.categories.length > 0) {
            const userCategories = expandCategoriesForRAG(targetAccount.categories);
            await this.ragService.indexUserCategories(userCache.gastoCertoId, userCategories, targetAccountId);
          }
        }
      } catch (indexError) {
        this.logger.error('[ANALYZE] Erro ao indexar:', indexError);
      }
    }

    const queryNormalized = this.ragService.normalizeText(query);
    const queryTokens = this.ragService.tokenizeText(queryNormalized);

    const allCategories = targetAccountId
      ? await this.ragService.getCachedCategories(userCache.gastoCertoId, targetAccountId)
      : [];

    if (allCategories.length === 0) {
      return { query, queryNormalized, queryTokens, categories: [] };
    }

    // Execute real RAG and build results map
    const ragResults = targetAccountId
      ? await this.ragService.findSimilarCategories(query, userCache.gastoCertoId, { accountId: targetAccountId })
      : [];
    const ragResultsMap = new Map<string, any>();
    ragResults.forEach((r) => {
      ragResultsMap.set(`${r.categoryId}:${r.subCategoryId || 'null'}`, r);
    });

    const categoriesWithScores = allCategories.map((cat) => {
      const key = `${cat.id}:${cat.subCategory?.id || 'null'}`;
      const ragResult = ragResultsMap.get(key);

      if (ragResult) {
        const reasons: string[] = [];
        const tokens = this.ragService.tokenizeText(this.ragService.normalizeText(query));
        const fullText = cat.subCategory?.name ? `${cat.name} ${cat.subCategory.name}` : cat.name;
        const categoryTokens = this.ragService.tokenizeText(this.ragService.normalizeText(fullText));

        const bm25Score = this.ragService.calculateBM25Score(tokens, categoryTokens);
        if (bm25Score > 0) reasons.push(`BM25: ${bm25Score.toFixed(4)}`);

        if (cat.subCategory?.name) {
          const normalizedSubCat = this.ragService.normalizeText(cat.subCategory.name);
          const subCatRegex = new RegExp(`\\b${normalizedSubCat}\\b`, 'i');
          if (normalizedSubCat.length >= 3 && subCatRegex.test(this.ragService.normalizeText(query))) {
            reasons.push('Match direto: +10.0');
          }
        }

        const matchingTokens = tokens.filter((qt) => categoryTokens.includes(qt));
        if (matchingTokens.length > 0) {
          reasons.push(
            `Tokens: [${matchingTokens.join(', ')}] (+${(matchingTokens.length * 2.0).toFixed(1)})`,
          );
        }

        if (tokens.length > 0 && tokens.every((token) => categoryTokens.includes(token))) {
          reasons.push('All tokens: +8.0');
        }

        return {
          categoryId: cat.id,
          categoryName: cat.name,
          subCategoryId: cat.subCategory?.id,
          subCategoryName: cat.subCategory?.name,
          score: ragResult.score,
          matchedTokens: matchingTokens,
          reason:
            reasons.length > 0 ? reasons.join(' | ') : `Score RAG: ${ragResult.score.toFixed(4)}`,
        };
      }

      return {
        categoryId: cat.id,
        categoryName: cat.name,
        subCategoryId: cat.subCategory?.id,
        subCategoryName: cat.subCategory?.name,
        score: 0,
        matchedTokens: [] as string[],
        reason: 'Sem match',
      };
    });

    categoriesWithScores.sort((a, b) => b.score - a.score);

    return {
      query,
      queryNormalized,
      queryTokens,
      categories: categoriesWithScores.slice(0, 20),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  //  SYNONYM MANAGEMENT
  // ═══════════════════════════════════════════════════════════════

  /**
   * POST /admin/rag/synonym/global
   * Create global synonym (applied to all users)
   * Body: { keyword: string, categoryName: string, subCategoryName?: string }
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
  ) {
    const { keyword, categoryName, subCategoryName } = body;

    if (!keyword || !categoryName) {
      throw new BadRequestException('keyword e categoryName são obrigatórios');
    }

    this.logger.log(
      `[SYNONYM] Criando sinônimo global: "${keyword}" → ${categoryName}${subCategoryName ? ' > ' + subCategoryName : ''}`,
    );

    const synonym = await this.prisma.userSynonym.create({
      data: {
        userId: null,
        keyword: keyword.toLowerCase().trim(),
        categoryId: null,
        categoryName: categoryName.trim(),
        subCategoryId: null,
        subCategoryName: subCategoryName?.trim() || null,
        confidence: 1.0,
        source: 'ADMIN_APPROVED',
      },
    });

    await this.ragService.clearCache();

    return {
      message: 'Sinônimo global criado com sucesso',
      synonym,
    };
  }

  /**
   * POST /admin/rag/synonym/user
   * Create synonym for a specific user
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
  ) {
    const { userId, keyword, categoryId, subCategoryId } = body;

    const userCache = await this.prisma.userCache.findUnique({
      where: { gastoCertoId: userId },
      select: { gastoCertoId: true },
    });

    if (!userCache) {
      throw new BadRequestException(`Usuário ${userId} não encontrado no cache`);
    }

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
   * GET /admin/rag/synonyms/:userId
   * List all synonyms for a specific user
   */
  @Get('synonyms/:userId')
  async getUserSynonyms(@Param('userId') userId: string) {
    const userCache = await this.prisma.userCache.findUnique({
      where: { gastoCertoId: userId },
      select: { gastoCertoId: true },
    });

    if (!userCache) {
      throw new BadRequestException(`Usuário ${userId} não encontrado no cache`);
    }

    return await this.prisma.userSynonym.findMany({
      where: { userId: userCache.gastoCertoId },
      orderBy: { confidence: 'desc' },
    });
  }

  // ═══════════════════════════════════════════════════════════════
  //  PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════

  private generateSuggestions(matches: any[], query: string): any[] {
    const suggestions: any[] = [];

    if (matches.length === 0 || matches[0].score < 0.5) {
      suggestions.push({
        type: 'low_match',
        keyword: query,
        reason: 'Nenhum match forte encontrado - considere criar sinônimo',
        confidence: 0.5,
      });
    }

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
