import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@core/database/prisma.service';
import { TextProcessingService } from './text-processing.service';
import { CategoryMatch } from './rag.interface';

export interface SearchAttemptOptions {
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
}

/**
 * RagAnalyticsService
 *
 * Responsabilidade única: persistir logs de busca RAG para analytics.
 *
 * IMPORTANTE: O método `record()` deve ser chamado como fire-and-forget
 * nos hot paths (`void this.analytics.record(...)`) para não adicionar
 * latência ao fluxo de classificação do usuário.
 *
 * Exemplo:
 * ```typescript
 * // No hot path — não bloqueia a resposta
 * void this.analytics.record(userId, text, results, success, threshold, 'BM25', responseTime);
 *
 * // Quando precisa do ID gerado (ex: para associar ao TransactionConfirmation)
 * const logId = await this.analytics.record(...);
 * ```
 */
@Injectable()
export class RagAnalyticsService {
  private readonly logger = new Logger(RagAnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly textProcessing: TextProcessingService,
  ) {}

  /**
   * Registra tentativa de busca no banco para analytics.
   * Seguro para uso fire-and-forget — nunca lança exceção.
   */
  async record(
    userId: string,
    query: string,
    matches: CategoryMatch[],
    success: boolean,
    threshold: number,
    ragMode: string,
    responseTime: number,
    options?: SearchAttemptOptions,
  ): Promise<string | null> {
    try {
      if (!this.prisma) return null;

      const bestMatch = matches.length > 0 ? matches[0] : null;

      const log = await this.prisma.rAGSearchLog.create({
        data: {
          userId,
          query,
          queryNormalized: this.textProcessing.normalize(query),
          matches: matches as any,
          bestMatch: bestMatch?.categoryName || null,
          bestScore: bestMatch?.score || null,
          threshold,
          success,
          ragMode,
          responseTime,
          flowStep: options?.flowStep || 1,
          totalSteps: options?.totalSteps || 1,
          aiProvider: options?.aiProvider,
          aiModel: options?.aiModel,
          aiConfidence: options?.aiConfidence,
          aiCategoryId: options?.aiCategoryId,
          aiCategoryName: options?.aiCategoryName,
          finalCategoryId: options?.finalCategoryId || bestMatch?.categoryId,
          finalCategoryName: options?.finalCategoryName || bestMatch?.categoryName,
          ragInitialScore: bestMatch?.score,
          ragFinalScore: options?.finalCategoryId ? bestMatch?.score : null,
          wasAiFallback: options?.wasAiFallback || false,
        },
      });

      return log?.id || null;
    } catch (error) {
      // Logging não deve quebrar o fluxo
      this.logger.error(`❌ Erro ao salvar log RAG (userId: ${userId}, query: "${query}"):`, error);
      return null;
    }
  }

  /**
   * API pública para registrar busca com contexto completo de multi-step flow.
   * Usado por CategoryResolutionService.
   */
  async logWithContext(params: {
    userId: string;
    query: string;
    matches: CategoryMatch[];
    success: boolean;
    threshold: number;
    ragMode: string;
    responseTime: number;
  } & SearchAttemptOptions): Promise<string | null> {
    const { userId, query, matches, success, threshold, ragMode, responseTime, ...options } =
      params;
    return this.record(userId, query, matches, success, threshold, ragMode, responseTime, options);
  }

  /**
   * Retorna logs de busca para analytics (admin).
   */
  async getSearchAttempts(
    userId?: string,
    failedOnly: boolean = false,
    limit: number = 20,
    offset: number = 0,
  ): Promise<{
    logs: Array<{
      id: string;
      userId: string;
      query: string;
      queryNormalized: string;
      matches: any;
      bestMatch: string | null;
      bestScore: number | null;
      threshold: number;
      success: boolean;
      ragMode: string;
      responseTime: number;
      createdAt: Date;
    }>;
    total: number;
    limit: number;
    offset: number;
  }> {
    const where: any = {};
    if (userId) where.userId = userId;
    if (failedOnly) where.success = false;

    const [total, logs] = await Promise.all([
      this.prisma.rAGSearchLog.count({ where }),
      this.prisma.rAGSearchLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          userId: true,
          query: true,
          queryNormalized: true,
          matches: true,
          bestMatch: true,
          bestScore: true,
          threshold: true,
          success: true,
          ragMode: true,
          responseTime: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      logs: logs.map((log) => ({
        ...log,
        bestScore: log.bestScore ? Number(log.bestScore) : null,
        threshold: log.threshold ? Number(log.threshold) : 0,
      })),
      total,
      limit,
      offset,
    };
  }

  /**
   * Remove logs por IDs (admin).
   */
  async deleteSearchLogs(ids: string[]): Promise<{ deletedCount: number }> {
    this.logger.log(`🗑️ Deletando ${ids.length} logs RAG...`);
    const result = await this.prisma.rAGSearchLog.deleteMany({
      where: { id: { in: ids } },
    });
    this.logger.log(`✅ Deletados ${result.count} logs`);
    return { deletedCount: result.count };
  }
}
