import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@core/database/prisma.service';
import { AIOperationType, AIInputType } from '@prisma/client';

interface AIUsageData {
  phoneNumber: string;
  userCacheId?: string;
  provider: string;
  model: string;
  operation: AIOperationType;
  inputType: AIInputType;
  inputText?: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  responseTime?: number;
  success: boolean;
  errorMessage?: string;
  metadata?: Record<string, any>;
}

/**
 * AIUsageTracker
 * Registra uso de IA e calcula custos
 */
@Injectable()
export class AIUsageTrackerService {
  private readonly logger = new Logger(AIUsageTrackerService.name);

  // Custos por provider/modelo (USD por 1M tokens)
  // Fonte: https://openai.com/pricing, https://ai.google.dev/pricing
  private readonly COSTS = {
    openai: {
      'gpt-4o': { input: 2.5, output: 10.0 },
      'gpt-4o-mini': { input: 0.15, output: 0.6 },
      'text-embedding-3-small': { input: 0.02, output: 0 },
      'text-embedding-3-large': { input: 0.13, output: 0 },
    },
    groq: {
      'llama-3.3-70b-versatile': { input: 0.59, output: 0.79 },
      'llama-3.1-8b-instant': { input: 0.05, output: 0.08 },
      'mixtral-8x7b-32768': { input: 0.24, output: 0.24 },
    },
    google_gemini: {
      'gemini-1.5-flash': { input: 0.075, output: 0.3 },
      'gemini-1.5-pro': { input: 1.25, output: 5.0 },
      'gemini-2.0-flash-exp': { input: 0.0, output: 0.0 }, // Free preview
    },
    deepseek: {
      'deepseek-chat': { input: 0.14, output: 0.28 },
      'deepseek-reasoner': { input: 0.55, output: 2.19 },
    },
  };

  constructor(private prisma: PrismaService) {}

  /**
   * Registra uso de IA e calcula custo
   */
  async trackUsage(data: AIUsageData): Promise<void> {
    try {
      const totalTokens = data.inputTokens + data.outputTokens;
      const estimatedCost = this.calculateCost(
        data.provider,
        data.model,
        data.inputTokens,
        data.outputTokens,
      );

      await this.prisma.aIUsageLog.create({
        data: {
          userCacheId: data.userCacheId,
          phoneNumber: data.phoneNumber,
          provider: data.provider,
          model: data.model,
          operation: data.operation,
          inputType: data.inputType,
          inputText: data.inputText?.substring(0, 1000), // Limite 1000 chars
          inputTokens: data.inputTokens,
          outputTokens: data.outputTokens,
          totalTokens,
          estimatedCost,
          responseTime: data.responseTime,
          success: data.success,
          errorMessage: data.errorMessage,
          metadata: data.metadata || {},
        },
      });

      this.logger.debug(
        `💰 AI Usage tracked: ${data.provider}/${data.model} | ${data.operation} | ` +
          `${totalTokens} tokens | $${estimatedCost.toFixed(6)}`,
      );
    } catch (error) {
      this.logger.error('Failed to track AI usage', error);
    }
  }

  /**
   * Calcula custo estimado em USD
   */
  private calculateCost(
    provider: string,
    model: string,
    inputTokens: number,
    outputTokens: number,
  ): number {
    const providerCosts = this.COSTS[provider as keyof typeof this.COSTS];
    if (!providerCosts) {
      this.logger.warn(`Unknown provider for cost calculation: ${provider}`);
      return 0;
    }

    const modelCosts = providerCosts[model as keyof typeof providerCosts] as
      | { input: number; output: number }
      | undefined;
    if (!modelCosts) {
      this.logger.warn(`Unknown model for cost calculation: ${provider}/${model}`);
      return 0;
    }

    const inputCost = (inputTokens / 1_000_000) * modelCosts.input;
    const outputCost = (outputTokens / 1_000_000) * modelCosts.output;

    return inputCost + outputCost;
  }

  /**
   * Busca custos totais por período
   */
  async getTotalCost(
    startDate?: Date,
    endDate?: Date,
  ): Promise<{ totalCost: number; totalTokens: number; requestCount: number }> {
    const result = await this.prisma.aIUsageLog.aggregate({
      where: {
        createdAt: {
          ...(startDate && { gte: startDate }),
          ...(endDate && { lte: endDate }),
        },
      },
      _sum: {
        estimatedCost: true,
        totalTokens: true,
      },
      _count: true,
    });

    return {
      totalCost: Number(result._sum.estimatedCost || 0),
      totalTokens: result._sum.totalTokens || 0,
      requestCount: result._count,
    };
  }

  /**
   * Busca custos por usuário
   */
  async getUserCost(
    phoneNumber: string,
    startDate?: Date,
    endDate?: Date,
  ): Promise<{ totalCost: number; totalTokens: number; requestCount: number }> {
    const result = await this.prisma.aIUsageLog.aggregate({
      where: {
        phoneNumber,
        createdAt: {
          ...(startDate && { gte: startDate }),
          ...(endDate && { lte: endDate }),
        },
      },
      _sum: {
        estimatedCost: true,
        totalTokens: true,
      },
      _count: true,
    });

    return {
      totalCost: Number(result._sum.estimatedCost || 0),
      totalTokens: result._sum.totalTokens || 0,
      requestCount: result._count,
    };
  }

  /**
   * Busca custos por provider
   */
  async getCostByProvider(
    startDate?: Date,
    endDate?: Date,
  ): Promise<
    Array<{
      provider: string;
      totalCost: number;
      totalTokens: number;
      requestCount: number;
    }>
  > {
    const results = await this.prisma.aIUsageLog.groupBy({
      by: ['provider'],
      where: {
        createdAt: {
          ...(startDate && { gte: startDate }),
          ...(endDate && { lte: endDate }),
        },
      },
      _sum: {
        estimatedCost: true,
        totalTokens: true,
      },
      _count: true,
    });

    return results.map((r) => ({
      provider: r.provider,
      totalCost: Number(r._sum.estimatedCost || 0),
      totalTokens: r._sum.totalTokens || 0,
      requestCount: r._count,
    }));
  }

  /**
   * Busca custos por operação
   */
  async getCostByOperation(
    startDate?: Date,
    endDate?: Date,
  ): Promise<
    Array<{
      operation: AIOperationType;
      totalCost: number;
      totalTokens: number;
      requestCount: number;
    }>
  > {
    const results = await this.prisma.aIUsageLog.groupBy({
      by: ['operation'],
      where: {
        createdAt: {
          ...(startDate && { gte: startDate }),
          ...(endDate && { lte: endDate }),
        },
      },
      _sum: {
        estimatedCost: true,
        totalTokens: true,
      },
      _count: true,
    });

    return results.map((r) => ({
      operation: r.operation,
      totalCost: Number(r._sum.estimatedCost || 0),
      totalTokens: r._sum.totalTokens || 0,
      requestCount: r._count,
    }));
  }

  /**
   * Top usuários por custo
   */
  async getTopUsersByCost(
    limit = 10,
    startDate?: Date,
    endDate?: Date,
  ): Promise<
    Array<{
      phoneNumber: string;
      totalCost: number;
      totalTokens: number;
      requestCount: number;
    }>
  > {
    const results = await this.prisma.aIUsageLog.groupBy({
      by: ['phoneNumber'],
      where: {
        createdAt: {
          ...(startDate && { gte: startDate }),
          ...(endDate && { lte: endDate }),
        },
      },
      _sum: {
        estimatedCost: true,
        totalTokens: true,
      },
      _count: true,
      orderBy: {
        _sum: {
          estimatedCost: 'desc',
        },
      },
      take: limit,
    });

    return results.map((r) => ({
      phoneNumber: r.phoneNumber,
      totalCost: Number(r._sum.estimatedCost || 0),
      totalTokens: r._sum.totalTokens || 0,
      requestCount: r._count,
    }));
  }

  /**
   * Estatísticas de performance
   */
  async getPerformanceStats(
    startDate?: Date,
    endDate?: Date,
  ): Promise<{
    avgResponseTime: number;
    successRate: number;
    totalRequests: number;
  }> {
    const [avgTime, stats] = await Promise.all([
      this.prisma.aIUsageLog.aggregate({
        where: {
          createdAt: {
            ...(startDate && { gte: startDate }),
            ...(endDate && { lte: endDate }),
          },
          responseTime: { not: null },
        },
        _avg: {
          responseTime: true,
        },
      }),
      this.prisma.aIUsageLog.groupBy({
        by: ['success'],
        where: {
          createdAt: {
            ...(startDate && { gte: startDate }),
            ...(endDate && { lte: endDate }),
          },
        },
        _count: true,
      }),
    ]);

    const totalRequests = stats.reduce((sum, s) => sum + s._count, 0);
    const successRequests = stats.find((s) => s.success)?._count || 0;

    return {
      avgResponseTime: avgTime._avg.responseTime || 0,
      successRate: totalRequests > 0 ? successRequests / totalRequests : 0,
      totalRequests,
    };
  }

  /**
   * Limpa logs antigos (> 90 dias)
   */
  async cleanOldLogs(): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 90);

    const result = await this.prisma.aIUsageLog.deleteMany({
      where: {
        createdAt: { lt: cutoffDate },
      },
    });

    this.logger.log(`🧹 Cleaned ${result.count} old AI usage logs`);
    return result.count;
  }
}
