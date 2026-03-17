import {
  Controller,
  Post,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
  Get,
  Query,
  Param,
  Put,
  Body,
} from '@nestjs/common';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { PrismaService } from '@core/database/prisma.service';
import { AIConfigService } from '../../../infrastructure/ai/ai-config.service';

@Controller('admin')
@UseGuards(JwtAuthGuard)
export class AdminAIConfigController {
  private readonly logger = new Logger(AdminAIConfigController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiConfigService: AIConfigService,
  ) {}

  /**
   * Mascara uma API key para exibição segura
   * Ex: "sk-proj-abc123xyz" → "sk-p****xyz"
   */
  private maskApiKey(key: string): string {
    if (!key) return '';
    // Se a key está criptografada (enc:...), mostrar apenas que está criptografada
    if (key.startsWith('enc:')) return '🔒 [encrypted]';
    // Mostrar primeiros 4 e últimos 4 caracteres
    if (key.length <= 8) return '****';
    return `${key.substring(0, 4)}****${key.substring(key.length - 4)}`;
  }

  /**
   * Lista logs de uso de IA
   * GET /admin/ai-usage-logs?provider=openai&operation=TRANSACTION_EXTRACTION&from=2024-01-01&to=2024-12-31&limit=100&page=1
   */
  @Get('ai-usage-logs')
  async listAIUsageLogs(
    @Query('provider') provider?: string,
    @Query('operation') operation?: string,
    @Query('phoneNumber') phoneNumber?: string,
    @Query('success') success?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('page') page?: string,
  ) {
    this.logger.log('📋 Admin solicitou lista de logs de uso de IA');

    try {
      const pageNum = parseInt(page || '1');
      const limitNum = parseInt(limit || '100');
      const skip = (pageNum - 1) * limitNum;

      const where: any = {};

      if (provider) {
        where.provider = provider;
      }

      if (operation) {
        where.operation = operation;
      }

      if (phoneNumber) {
        where.phoneNumber = phoneNumber;
      }

      if (success !== undefined) {
        where.success = success === 'true';
      }

      if (from || to) {
        where.createdAt = {};
        if (from) {
          where.createdAt.gte = new Date(from);
        }
        if (to) {
          where.createdAt.lte = new Date(to);
        }
      }

      const [logs, total] = await Promise.all([
        this.prisma.aIUsageLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limitNum,
          select: {
            id: true,
            phoneNumber: true,
            provider: true,
            model: true,
            operation: true,
            inputType: true,
            inputTokens: true,
            outputTokens: true,
            totalTokens: true,
            estimatedCost: true,
            responseTime: true,
            success: true,
            errorMessage: true,
            createdAt: true,
          },
        }),
        this.prisma.aIUsageLog.count({ where }),
      ]);

      return {
        success: true,
        data: logs,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      };
    } catch (error: any) {
      this.logger.error('❌ Erro ao buscar logs de IA:', error);
      throw error;
    }
  }

  /**
   * Estatísticas de uso de IA agrupadas por provider
   * GET /admin/ai-usage-logs/stats?from=2024-01-01&to=2024-12-31&operation=TRANSACTION_EXTRACTION
   */
  @Get('ai-usage-logs/stats')
  async getAIUsageStats(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('operation') operation?: string,
  ) {
    this.logger.log('📊 Admin solicitou estatísticas de uso de IA');

    try {
      const where: any = {};

      if (from || to) {
        where.createdAt = {};
        if (from) {
          where.createdAt.gte = new Date(from);
        }
        if (to) {
          where.createdAt.lte = new Date(to);
        }
      }

      if (operation) {
        where.operation = operation;
      }

      // Estatísticas gerais
      const [totalLogs, successLogs, totalCost, avgResponseTime] = await Promise.all([
        this.prisma.aIUsageLog.count({ where }),
        this.prisma.aIUsageLog.count({ where: { ...where, success: true } }),
        this.prisma.aIUsageLog.aggregate({
          where,
          _sum: { estimatedCost: true },
        }),
        this.prisma.aIUsageLog.aggregate({
          where: { ...where, responseTime: { not: null } },
          _avg: { responseTime: true },
        }),
      ]);

      // Estatísticas por provider
      const providerStats = await this.prisma.aIUsageLog.groupBy({
        by: ['provider'],
        where,
        _count: { _all: true },
        _sum: {
          inputTokens: true,
          outputTokens: true,
          totalTokens: true,
          estimatedCost: true,
        },
        _avg: {
          responseTime: true,
          estimatedCost: true,
        },
      });

      // Estatísticas por operação
      const operationStats = await this.prisma.aIUsageLog.groupBy({
        by: ['operation'],
        where,
        _count: { _all: true },
        _sum: {
          totalTokens: true,
          estimatedCost: true,
        },
        _avg: {
          estimatedCost: true,
        },
      });

      // Estatísticas por model
      const modelStats = await this.prisma.aIUsageLog.groupBy({
        by: ['model', 'provider'],
        where,
        _count: { _all: true },
        _sum: {
          totalTokens: true,
          estimatedCost: true,
        },
      });

      return {
        success: true,
        data: {
          overview: {
            totalRequests: totalLogs,
            successRequests: successLogs,
            failureRequests: totalLogs - successLogs,
            successRate: totalLogs > 0 ? (successLogs / totalLogs) * 100 : 0,
            totalCost: totalCost._sum.estimatedCost || 0,
            avgResponseTime: avgResponseTime._avg.responseTime || 0,
          },
          byProvider: providerStats.map((stat) => ({
            provider: stat.provider,
            requests: stat._count._all,
            totalTokens: stat._sum.totalTokens || 0,
            totalCost: stat._sum.estimatedCost || 0,
            avgCost: stat._avg.estimatedCost || 0,
            avgResponseTime: stat._avg.responseTime || 0,
          })),
          byOperation: operationStats.map((stat) => ({
            operation: stat.operation,
            requests: stat._count._all,
            totalTokens: stat._sum.totalTokens || 0,
            totalCost: stat._sum.estimatedCost || 0,
            avgCost: stat._avg.estimatedCost || 0,
          })),
          byModel: modelStats.map((stat) => ({
            model: stat.model,
            provider: stat.provider,
            requests: stat._count._all,
            totalTokens: stat._sum.totalTokens || 0,
            totalCost: stat._sum.estimatedCost || 0,
          })),
        },
      };
    } catch (error: any) {
      this.logger.error('❌ Erro ao buscar estatísticas de IA:', error);
      throw error;
    }
  }

  /**
   * Lista configurações de provedores de IA
   * GET /admin/ai-providers
   * apiKey é mascarada na resposta (mostra apenas últimos 4 caracteres)
   */
  @Get('ai-providers')
  async listAIProviders() {
    this.logger.log('📋 Admin solicitou lista de provedores de IA');

    try {
      const providers = await this.prisma.aIProviderConfig.findMany({
        orderBy: { priority: 'asc' },
      });

      // Mascarar apiKey na resposta
      const maskedProviders = providers.map((p) => ({
        ...p,
        apiKey: p.apiKey ? this.maskApiKey(p.apiKey) : null,
      }));

      return {
        success: true,
        data: maskedProviders,
      };
    } catch (error: any) {
      this.logger.error('❌ Erro ao buscar provedores de IA:', error);
      throw error;
    }
  }

  /**
   * Busca configuração de um provider específico
   * GET /admin/ai-providers/:provider
   * apiKey é mascarada na resposta
   */
  @Get('ai-providers/:provider')
  async getAIProvider(@Param('provider') provider: string) {
    this.logger.log(`📋 Admin solicitou configuração do provider: ${provider}`);

    try {
      const config = await this.aiConfigService.getProviderConfig(provider);

      if (!config) {
        return {
          success: false,
          message: 'Provider não encontrado',
        };
      }

      return {
        success: true,
        data: {
          ...config,
          apiKey: config.apiKey ? this.maskApiKey(config.apiKey) : null,
        },
      };
    } catch (error: any) {
      this.logger.error(`❌ Erro ao buscar provider ${provider}:`, error);
      throw error;
    }
  }

  /**
   * Atualiza configuração de um provider
   * PUT /admin/ai-providers/:provider
   * apiKey é criptografada pelo AIConfigService antes de salvar
   */
  @Put('ai-providers/:provider')
  @HttpCode(HttpStatus.OK)
  async updateAIProvider(@Param('provider') provider: string, @Body() updateData: any) {
    this.logger.log(`🔧 Admin atualizou configuração do provider: ${provider}`);

    try {
      const updated = await this.aiConfigService.updateProviderConfig(provider, updateData);

      return {
        success: true,
        data: {
          ...updated,
          apiKey: updated.apiKey ? this.maskApiKey(updated.apiKey) : null,
        },
        message: 'Configuração atualizada com sucesso',
      };
    } catch (error: any) {
      this.logger.error(`❌ Erro ao atualizar provider ${provider}:`, error);
      throw error;
    }
  }

  /**
   * Inicializa providers com configurações padrão
   * POST /admin/ai-providers/seed
   */
  @Post('ai-providers/seed')
  @HttpCode(HttpStatus.OK)
  async seedAIProviders() {
    this.logger.log('🌱 Admin solicitou seed de providers padrão');

    try {
      await this.aiConfigService.seedDefaultConfigs();

      return {
        success: true,
        message: 'Providers padrão inicializados com sucesso',
      };
    } catch (error: any) {
      this.logger.error('❌ Erro ao seed de providers:', error);
      throw error;
    }
  }

  // ==================== AI Settings ====================

  /**
   * GET /admin/ai-settings
   * Busca configurações globais de IA (incluindo RAG, Assistant, etc)
   */
  @Get('ai-settings')
  async getAISettings() {
    this.logger.log('📋 Admin solicitou configurações globais de IA');

    try {
      const settings = await this.aiConfigService.getSettings();

      return {
        success: true,
        data: settings,
        message: 'Configurações de IA obtidas com sucesso',
      };
    } catch (error: any) {
      this.logger.error('❌ Erro ao buscar configurações de IA:', error);
      throw error;
    }
  }

  /**
   * PUT /admin/ai-settings
   * Atualiza configurações globais de IA (incluindo RAG, Assistant, etc)
   *
   * Body completo:
   * {
   *   // Providers por operação
   *   "textProvider": "openai",
   *   "imageProvider": "google_gemini",
   *   "audioProvider": "groq",
   *   "categoryProvider": "groq",
   *
   *   // Fallback
   *   "fallbackEnabled": true,
   *   "fallbackTextChain": ["groq", "deepseek", "google_gemini", "openai"],
   *   "fallbackImageChain": ["google_gemini", "openai"],
   *   "fallbackAudioChain": ["openai", "groq"],
   *   "fallbackCategoryChain": ["groq", "deepseek", "google_gemini", "openai"],
   *
   *   // Cache
   *   "cacheEnabled": false,
   *   "cacheTTL": 3600,
   *
   *   // Rate Limiting
   *   "rateLimitEnabled": true,
   *
   *   // RAG (Retrieval-Augmented Generation)
   *   "ragEnabled": true,
   *   "ragAiEnabled": false,
   *   "ragAiProvider": "groq",
   *   "ragProvider": "bm25",
   *   "ragThreshold": 0.75,
   *   "ragAutoApply": 0.88,
   *   "ragCacheEnabled": true,
   *
   *   // Assistente Conversacional
   *   "assistantEnabled": true,
   *   "assistantPersonality": "friendly",
   *   "assistantMaxHistoryMsgs": 5
   * }
   */
  @Put('ai-settings')
  async updateAISettings(@Body() body: any) {
    this.logger.log('✏️  Admin solicitou atualização das configurações de IA');
    this.logger.debug('Dados recebidos:', JSON.stringify(body, null, 2));

    try {
      const settings = await this.aiConfigService.updateSettings(body);

      return {
        success: true,
        message: 'Configurações de IA atualizadas com sucesso',
        data: settings,
      };
    } catch (error: any) {
      this.logger.error('❌ Erro ao atualizar configurações de IA:', error);
      throw error;
    }
  }
}
