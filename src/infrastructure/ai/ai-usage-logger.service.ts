import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@core/database/prisma.service';
import { AIOperationType, AIInputType } from '@prisma/client';

/**
 * Interface para dados de uso de IA
 */
export interface AIUsageData {
  userCacheId?: string;
  gastoCertoId?: string;
  phoneNumber: string;
  platform?: string; // 'whatsapp', 'telegram', 'webchat'
  provider: string; // 'openai', 'google-gemini', 'groq'
  model: string;
  operation: AIOperationType;
  inputType: AIInputType;
  inputText?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  responseTime?: number;
  success?: boolean;
  errorMessage?: string;
  metadata?: any;
  // 🆕 Campos de contexto RAG
  ragSearchLogId?: string;
  ragInitialFound?: boolean;
  ragInitialScore?: number;
  ragInitialCategory?: string;
  aiCategoryId?: string;
  aiCategoryName?: string;
  aiConfidence?: number;
  finalCategoryId?: string;
  finalCategoryName?: string;
  wasRagFallback?: boolean;
  needsSynonymLearning?: boolean;
}

/**
 * Tabela de custos por modelo (USD por 1M tokens)
 * Atualizado em: Dezembro 2024
 */
const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  // OpenAI
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10.0, output: 30.0 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  'whisper-1': { input: 0.006, output: 0 }, // $0.006 por minuto
  'text-embedding-3-small': { input: 0.02, output: 0 },
  'text-embedding-3-large': { input: 0.13, output: 0 },

  // Google Gemini
  'gemini-1.5-pro': { input: 1.25, output: 5.0 },
  'gemini-1.5-flash': { input: 0.075, output: 0.3 },
  'gemini-1.0-pro': { input: 0.5, output: 1.5 },
  'gemini-2.0-flash-exp': { input: 0.0, output: 0.0 }, // Free preview

  // Groq
  'llama-3.3-70b-versatile': { input: 0.59, output: 0.79 },
  'llama-3.1-70b': { input: 0.59, output: 0.79 },
  'llama-3.1-8b-instant': { input: 0.05, output: 0.08 },
  'llama-3.1-8b': { input: 0.05, output: 0.08 },
  'mixtral-8x7b-32768': { input: 0.24, output: 0.24 },
  'mixtral-8x7b': { input: 0.24, output: 0.24 },

  // DeepSeek
  'deepseek-chat': { input: 0.14, output: 0.28 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 },

  // Default (caso não encontre o modelo)
  default: { input: 1.0, output: 2.0 },
};

@Injectable()
export class AIUsageLoggerService {
  private readonly logger = new Logger(AIUsageLoggerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registra uso de IA
   */
  async logUsage(data: AIUsageData): Promise<string> {
    try {
      // Calcular custo estimado
      const cost = this.calculateCost(data.model, data.inputTokens, data.outputTokens);

      // Criar registro com novos campos de tracking RAG
      const log = await this.prisma.aIUsageLog.create({
        data: {
          userCacheId: data.userCacheId,
          gastoCertoId: data.gastoCertoId,
          phoneNumber: data.phoneNumber,
          platform: data.platform,
          provider: data.provider,
          model: data.model,
          operation: data.operation,
          inputType: data.inputType,
          inputText: data.inputText?.substring(0, 1000), // Limitar a 1000 caracteres
          inputTokens: data.inputTokens,
          outputTokens: data.outputTokens,
          totalTokens: data.totalTokens,
          estimatedCost: cost,
          responseTime: data.responseTime,
          success: data.success ?? true,
          errorMessage: data.errorMessage,
          metadata: data.metadata || {},
          // 🆕 Campos de contexto RAG
          ragSearchLogId: data.ragSearchLogId,
          ragInitialFound: data.ragInitialFound,
          ragInitialScore: data.ragInitialScore,
          ragInitialCategory: data.ragInitialCategory,
          aiCategoryId: data.aiCategoryId,
          aiCategoryName: data.aiCategoryName,
          aiConfidence: data.aiConfidence,
          finalCategoryId: data.finalCategoryId,
          finalCategoryName: data.finalCategoryName,
          wasRagFallback: data.wasRagFallback ?? false,
          needsSynonymLearning: data.needsSynonymLearning ?? false,
        },
      });

      // Log estruturado
      const operationEmoji = this.getOperationEmoji(data.operation);
      const inputEmoji = this.getInputEmoji(data.inputType);

      let logMessage =
        `\n💰 ========== AUDITORIA IA ==========\n` +
        `${operationEmoji} Operação: ${data.operation}\n` +
        `${inputEmoji} Input: ${data.inputType}\n` +
        `🤖 Provider: ${data.provider}\n` +
        `📦 Model: ${data.model}\n` +
        `👤 Usuário: ${data.phoneNumber}${data.userCacheId ? ` (${data.userCacheId.substring(0, 8)}...)` : ''}\n` +
        `📊 Tokens: ${data.inputTokens} in + ${data.outputTokens} out = ${data.totalTokens} total\n` +
        `💵 Custo: $${cost.toFixed(6)} USD\n` +
        `⏱️  Tempo: ${data.responseTime ? `${data.responseTime}ms` : 'N/A'}\n`;

      // 🆕 Adicionar informações de contexto RAG se disponíveis
      if (data.ragSearchLogId) {
        logMessage += `🔍 RAG Context:\n`;
        logMessage += `   - RAG Log ID: ${data.ragSearchLogId.substring(0, 8)}...\n`;
        logMessage += `   - RAG Found: ${data.ragInitialFound ? '✅' : '❌'}\n`;
        if (data.ragInitialScore) {
          logMessage += `   - RAG Score: ${(data.ragInitialScore * 100).toFixed(1)}%\n`;
        }
        if (data.ragInitialCategory) {
          logMessage += `   - RAG Category: ${data.ragInitialCategory}\n`;
        }
        if (data.aiCategoryName) {
          logMessage += `   - AI Category: ${data.aiCategoryName}\n`;
        }
        if (data.aiConfidence) {
          logMessage += `   - AI Confidence: ${(data.aiConfidence * 100).toFixed(1)}%\n`;
        }
        if (data.finalCategoryName) {
          logMessage += `   - Final Category: ${data.finalCategoryName}\n`;
        }
        logMessage += `   - Was RAG Fallback: ${data.wasRagFallback ? '🔄' : '🎯'}\n`;
        logMessage += `   - Needs Learning: ${data.needsSynonymLearning ? '📚' : '✅'}\n`;
      }

      logMessage += `✅ Status: ${data.success ? 'Sucesso' : 'Erro'}\n` + `====================================\n`;

      this.logger.log(logMessage);

      return log.id;
    } catch (error) {
      this.logger.error('❌ Erro ao registrar uso de IA:', error);
      return null;
    }
  }

  /**
   * Calcula custo estimado
   */
  private calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    const costs = MODEL_COSTS[model] || MODEL_COSTS.default;

    // Custo por milhão de tokens
    const inputCost = (inputTokens / 1_000_000) * costs.input;
    const outputCost = (outputTokens / 1_000_000) * costs.output;

    return inputCost + outputCost;
  }

  /**
   * Busca estatísticas de uso por usuário
   */
  async getUserUsageStats(
    userCacheId: string,
    days: number = 30,
  ): Promise<{
    totalCalls: number;
    totalTokens: number;
    totalCost: number;
    byOperation: Record<string, { calls: number; tokens: number; cost: number }>;
    byProvider: Record<string, { calls: number; tokens: number; cost: number }>;
  }> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const logs = await this.prisma.aIUsageLog.findMany({
      where: {
        userCacheId,
        createdAt: {
          gte: startDate,
        },
      },
    });

    const totalCalls = logs.length;
    const totalTokens = logs.reduce((sum, log) => sum + log.totalTokens, 0);
    const totalCost = logs.reduce((sum, log) => sum + Number(log.estimatedCost), 0);

    // Agrupar por operação
    const byOperation: Record<string, { calls: number; tokens: number; cost: number }> = {};
    const byProvider: Record<string, { calls: number; tokens: number; cost: number }> = {};

    logs.forEach((log) => {
      // Por operação
      if (!byOperation[log.operation]) {
        byOperation[log.operation] = { calls: 0, tokens: 0, cost: 0 };
      }
      byOperation[log.operation].calls++;
      byOperation[log.operation].tokens += log.totalTokens;
      byOperation[log.operation].cost += Number(log.estimatedCost);

      // Por provider
      if (!byProvider[log.provider]) {
        byProvider[log.provider] = { calls: 0, tokens: 0, cost: 0 };
      }
      byProvider[log.provider].calls++;
      byProvider[log.provider].tokens += log.totalTokens;
      byProvider[log.provider].cost += Number(log.estimatedCost);
    });

    return {
      totalCalls,
      totalTokens,
      totalCost,
      byOperation,
      byProvider,
    };
  }

  /**
   * Busca logs detalhados de um usuário
   */
  async getUserLogs(
    userCacheId: string,
    limit: number = 50,
  ): Promise<
    Array<{
      id: string;
      operation: string;
      inputType: string;
      provider: string;
      model: string;
      tokens: number;
      cost: number;
      success: boolean;
      createdAt: Date;
    }>
  > {
    const logs = await this.prisma.aIUsageLog.findMany({
      where: { userCacheId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        operation: true,
        inputType: true,
        provider: true,
        model: true,
        totalTokens: true,
        estimatedCost: true,
        success: true,
        createdAt: true,
      },
    });

    return logs.map((log) => ({
      id: log.id,
      operation: log.operation,
      inputType: log.inputType,
      provider: log.provider,
      model: log.model,
      tokens: log.totalTokens,
      cost: Number(log.estimatedCost),
      success: log.success,
      createdAt: log.createdAt,
    }));
  }

  // ========== Métodos de agregação/custo (migrados de AIUsageTrackerService) ==========

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
   * Busca custos por usuário (por phoneNumber)
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

  // ========== Helpers privados ==========

  /**
   * Emojis para operações
   */
  private getOperationEmoji(operation: AIOperationType): string {
    const emojis = {
      TRANSACTION_EXTRACTION: '💸',
      AUDIO_TRANSCRIPTION: '🎤',
      IMAGE_ANALYSIS: '📷',
      CATEGORY_SUGGESTION: '📂',
    };
    return emojis[operation] || '🤖';
  }

  /**
   * Emojis para tipos de input
   */
  private getInputEmoji(inputType: AIInputType): string {
    const emojis = {
      TEXT: '📝',
      AUDIO: '🎵',
      IMAGE: '🖼️',
    };
    return emojis[inputType] || '📄';
  }
}
