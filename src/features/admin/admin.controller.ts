import {
  Controller,
  Post,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
  Delete,
  Get,
  Query,
  Param,
  Put,
  Body,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { UserCacheService } from '../users/user-cache.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { PrismaService } from '@core/database/prisma.service';
import { AIConfigService } from '../../infrastructure/ai/ai-config.service';
import { SessionsService } from '@infrastructure/messaging/core/services/sessions.service';
import { SessionManagerService } from '@infrastructure/core/session-manager.service';
import { TelegramSessionsService } from '@infrastructure/telegram/providers/telegram-sessions.service';
import { RAGService } from '@infrastructure/rag/services/rag.service';
import { RedisService } from '@common/services/redis.service';

@Controller('admin')
@UseGuards(JwtAuthGuard)
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(
    private readonly cacheService: UserCacheService,
    private readonly prisma: PrismaService,
    private readonly aiConfigService: AIConfigService,
    private readonly sessionsService: SessionsService,
    private readonly sessionManager: SessionManagerService,
    private readonly telegramSessionsService: TelegramSessionsService,
    private readonly ragService: RAGService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Limpa todo o cache Redis
   * POST /admin/cache/clear
   * Header: x-admin-key: <ADMIN_API_KEY>
   */
  @Post('cache/clear')
  @HttpCode(HttpStatus.OK)
  async clearCache() {
    this.logger.log('🧹 Admin solicitou limpeza de cache');

    try {
      await this.cacheService.clearAllCache();

      this.logger.log('✅ Cache Redis limpo com sucesso');

      return {
        success: true,
        message: 'Cache Redis limpo com sucesso',
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      this.logger.error('❌ Erro ao limpar cache:', error);

      return {
        success: false,
        message: 'Erro ao limpar cache',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Endpoint alternativo com DELETE
   * DELETE /admin/cache
   */
  @Delete('cache')
  @HttpCode(HttpStatus.OK)
  async deleteCacheAlternative() {
    return this.clearCache();
  }

  /**
   * Lista mensagens não reconhecidas
   * GET /admin/unrecognized-messages?wasProcessed=false&limit=50&page=1
   */
  @Get('unrecognized-messages')
  async listUnrecognizedMessages(
    @Query('wasProcessed') wasProcessed?: string,
    @Query('addedToContext') addedToContext?: string,
    @Query('phoneNumber') phoneNumber?: string,
    @Query('limit') limit?: string,
    @Query('page') page?: string,
  ) {
    this.logger.log('📋 Admin solicitou lista de mensagens não reconhecidas');

    try {
      const pageNum = parseInt(page || '1');
      const limitNum = parseInt(limit || '50');
      const skip = (pageNum - 1) * limitNum;

      const where: any = {};

      if (wasProcessed !== undefined) {
        where.wasProcessed = wasProcessed === 'true';
      }

      if (addedToContext !== undefined) {
        where.addedToContext = addedToContext === 'true';
      }

      if (phoneNumber) {
        where.phoneNumber = phoneNumber;
      }

      const [messages, total] = await Promise.all([
        this.prisma.unrecognizedMessage.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limitNum,
          select: {
            id: true,
            phoneNumber: true,
            messageText: true,
            detectedIntent: true,
            confidence: true,
            wasProcessed: true,
            addedToContext: true,
            userFeedback: true,
            createdAt: true,
            userCache: {
              select: {
                id: true,
                name: true,
                phoneNumber: true,
                gastoCertoId: true,
              },
            },
          },
        }),
        this.prisma.unrecognizedMessage.count({ where }),
      ]);

      // Formatar mensagens com dados do usuário e marcador de onboarding
      const formattedMessages = messages.map((msg) => ({
        ...msg,
        user: msg.userCache
          ? {
              id: msg.userCache.id,
              name: msg.userCache.name,
              phoneNumber: msg.userCache.phoneNumber,
              gastoCertoId: msg.userCache.gastoCertoId,
            }
          : null,
        isOnboarding: !msg.userCache, // Marca como possível onboarding se não tem user
        userCache: undefined, // Remove o campo original
      }));

      return {
        success: true,
        data: formattedMessages,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      };
    } catch (error: any) {
      this.logger.error('❌ Erro ao buscar mensagens não reconhecidas:', error);
      throw error;
    }
  }

  /**
   * Deleta mensagem não reconhecida
   * DELETE /admin/unrecognized-messages/:id
   */
  @Delete('unrecognized-messages/:id')
  @HttpCode(HttpStatus.OK)
  async deleteUnrecognizedMessage(@Param('id') id: string) {
    this.logger.log(`🗑️ Admin solicitou exclusão de mensagem: ${id}`);

    try {
      await this.prisma.unrecognizedMessage.delete({
        where: { id },
      });

      return {
        success: true,
        message: 'Mensagem deletada com sucesso',
      };
    } catch (error: any) {
      this.logger.error('❌ Erro ao deletar mensagem:', error);
      throw error;
    }
  }

  /**
   * Lista confirmações de transações
   * GET /admin/transaction-confirmations?status=PENDING&phoneNumber=5566996285154&from=2024-01-01&to=2024-12-31&limit=50&page=1
   */
  @Get('transaction-confirmations')
  async listTransactionConfirmations(
    @Query('status') status?: string,
    @Query('phoneNumber') phoneNumber?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('apiSent') apiSent?: string,
    @Query('limit') limit?: string,
    @Query('page') page?: string,
  ) {
    this.logger.log('📋 Admin solicitou lista de confirmações de transações');

    try {
      const pageNum = parseInt(page || '1');
      const limitNum = parseInt(limit || '50');
      const skip = (pageNum - 1) * limitNum;

      const where: any = {};

      if (status) {
        where.status = status;
      }

      if (phoneNumber) {
        where.phoneNumber = phoneNumber;
      }

      if (apiSent !== undefined) {
        where.apiSent = apiSent === 'true';
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

      const [confirmations, total] = await Promise.all([
        this.prisma.transactionConfirmation.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limitNum,
          select: {
            id: true,
            phoneNumber: true,
            type: true,
            amount: true,
            category: true,
            description: true,
            date: true,
            status: true,
            apiSent: true,
            apiSentAt: true,
            apiError: true,
            apiRetryCount: true,
            createdAt: true,
            expiresAt: true,
            confirmedAt: true,
          },
        }),
        this.prisma.transactionConfirmation.count({ where }),
      ]);

      return {
        success: true,
        data: confirmations,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      };
    } catch (error: any) {
      this.logger.error('❌ Erro ao buscar confirmações:', error);
      throw error;
    }
  }

  /**
   * Deleta confirmação de transação
   * DELETE /admin/transaction-confirmations/:id
   */
  @Delete('transaction-confirmations/:id')
  @HttpCode(HttpStatus.OK)
  async deleteTransactionConfirmation(@Param('id') id: string) {
    this.logger.log(`🗑️ Admin solicitou exclusão de confirmação: ${id}`);

    try {
      await this.prisma.transactionConfirmation.delete({
        where: { id },
      });

      return {
        success: true,
        message: 'Confirmação deletada com sucesso',
      };
    } catch (error: any) {
      this.logger.error('❌ Erro ao deletar confirmação:', error);
      throw error;
    }
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
   * Debug: Conta total de usuários no banco
   * GET /admin/users-cache/count
   */
  @Get('users-cache/count')
  async countUsersCache() {
    try {
      const total = await this.prisma.userCache.count();
      const sample = await this.prisma.userCache.findMany({
        take: 3,
        select: {
          id: true,
          phoneNumber: true,
          name: true,
          email: true,
          createdAt: true,
        },
      });

      this.logger.log(`📊 Total de usuários no banco: ${total}`);

      return {
        success: true,
        total,
        sample,
        message: total === 0 ? 'Nenhum usuário no banco de dados' : `${total} usuários encontrados`,
      };
    } catch (error: any) {
      this.logger.error('❌ Erro ao contar usuários:', error);
      throw error;
    }
  }

  /**
   * Lista usuários no cache Redis
   * GET /admin/users-cache?limit=50&page=1
   */
  @Get('users-cache')
  async listUsersCache(@Query('limit') limit?: string, @Query('page') page?: string) {
    this.logger.log('📋 Admin solicitou lista de usuários em cache');
    this.logger.log(`📊 Parâmetros recebidos - limit: ${limit}, page: ${page}`);

    try {
      const pageNum = parseInt(page || '1');
      const limitNum = parseInt(limit || '50');
      const skip = (pageNum - 1) * limitNum;

      this.logger.log(`📊 Paginação calculada - skip: ${skip}, take: ${limitNum}`);

      // Buscar usuários do banco de dados (UserCache)
      const [users, total] = await Promise.all([
        this.prisma.userCache.findMany({
          orderBy: { lastSyncAt: 'desc' },
          skip,
          take: limitNum,
          select: {
            id: true,
            phoneNumber: true,
            name: true,
            email: true,
            gastoCertoId: true,
            hasActiveSubscription: true,
            activeAccountId: true,
            isBlocked: true,
            isActive: true,
            lastSyncAt: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        this.prisma.userCache.count(),
      ]);

      this.logger.log(`📊 Encontrados ${users.length} usuários de ${total} no total`);

      // Se não há usuários, retornar resposta vazia
      if (users.length === 0) {
        this.logger.warn('⚠️ Nenhum usuário encontrado no banco de dados');
        return {
          success: true,
          data: [],
          pagination: {
            page: pageNum,
            limit: limitNum,
            total: 0,
            totalPages: 0,
          },
          message: 'Nenhum usuário encontrado no cache',
        };
      }

      // Para cada usuário, verificar se está no Redis e pegar TTL
      const usersWithCacheInfo = await Promise.all(
        users.map(async (user) => {
          const redisKey = `user:${user.phoneNumber}`;
          const redis = this.redisService.getClient();
          const ttl = await redis.ttl(redisKey);
          const inRedis = ttl > -2; // -2 significa que a chave não existe

          return {
            ...user,
            cache: {
              inRedis,
              ttl: ttl > 0 ? ttl : null, // null se não está no Redis
              lastAccess: user.lastSyncAt,
            },
          };
        }),
      );

      return {
        success: true,
        data: usersWithCacheInfo,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      };
    } catch (error: any) {
      this.logger.error('❌ Erro ao buscar usuários em cache:', error);
      throw error;
    }
  }

  /**
   * Busca usuários por nome ou telefone (sem paginação)
   * Para uso em autocomplete/busca rápida do admin
   *
   * GET /admin/users-cache/search?q=harold
   * GET /admin/users-cache/search?q=556699
   *
   * Retorna até 20 resultados
   */
  @Get('users-cache/search')
  async searchUsers(@Query('q') query?: string) {
    this.logger.log(`🔍 Admin buscando usuários: "${query}"`);

    try {
      if (!query || query.trim().length < 2) {
        throw new BadRequestException('Query deve ter pelo menos 2 caracteres');
      }

      const searchTerm = query.trim();

      // Buscar por nome ou telefone
      const users = await this.prisma.userCache.findMany({
        where: {
          OR: [
            {
              name: {
                contains: searchTerm,
                mode: 'insensitive',
              },
            },
            {
              phoneNumber: {
                contains: searchTerm,
              },
            },
            {
              email: {
                contains: searchTerm,
                mode: 'insensitive',
              },
            },
          ],
        },
        select: {
          id: true,
          phoneNumber: true,
          name: true,
          email: true,
          gastoCertoId: true,
          hasActiveSubscription: true,
          activeAccountId: true,
          isBlocked: true,
          isActive: true,
          lastSyncAt: true,
          createdAt: true,
        },
        orderBy: [{ isActive: 'desc' }, { lastSyncAt: 'desc' }],
        take: 20, // Limite de 20 resultados para busca rápida
      });

      this.logger.log(`✅ Encontrados ${users.length} usuários para query "${query}"`);

      return {
        success: true,
        data: users,
        count: users.length,
        query: searchTerm,
      };
    } catch (error: any) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error('❌ Erro ao buscar usuários:', error);
      throw error;
    }
  }

  /**
   * Lista configurações de provedores de IA
   * GET /admin/ai-providers
   */
  @Get('ai-providers')
  async listAIProviders() {
    this.logger.log('📋 Admin solicitou lista de provedores de IA');

    try {
      const providers = await this.prisma.aIProviderConfig.findMany({
        orderBy: { priority: 'asc' },
      });

      return {
        success: true,
        data: providers,
      };
    } catch (error: any) {
      this.logger.error('❌ Erro ao buscar provedores de IA:', error);
      throw error;
    }
  }

  /**
   * Busca configuração de um provider específico
   * GET /admin/ai-providers/:provider
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
        data: config,
      };
    } catch (error: any) {
      this.logger.error(`❌ Erro ao buscar provider ${provider}:`, error);
      throw error;
    }
  }

  /**
   * Atualiza configuração de um provider
   * PUT /admin/ai-providers/:provider
   */
  @Put('ai-providers/:provider')
  @HttpCode(HttpStatus.OK)
  async updateAIProvider(@Param('provider') provider: string, @Body() updateData: any) {
    this.logger.log(`🔧 Admin atualizou configuração do provider: ${provider}`);

    try {
      const updated = await this.aiConfigService.updateProviderConfig(provider, updateData);

      return {
        success: true,
        data: updated,
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

  // ==================== Sessions Management ====================

  /**
   * Lista usuários que enviaram mensagens recentemente
   * GET /admin/active-users?limit=50&hours=24
   */
  @Get('active-users')
  async getActiveUsers(@Query('limit') limit?: string, @Query('hours') hours?: string) {
    const limitNum = parseInt(limit || '50');
    const hoursNum = parseInt(hours || '24');
    const since = new Date(Date.now() - hoursNum * 60 * 60 * 1000);

    this.logger.log(`Buscando usuários ativos (últimas ${hoursNum}h, limit ${limitNum})`);

    const users = await this.prisma.$queryRaw<any[]>`
      SELECT 
        s.id,
        s."phoneNumber",
        s.name,
        s."isActive",
        s.status,
        s."lastSeen" as "lastMessageAt",
        0 as "messageCount"
      FROM whatsapp_sessions s
      WHERE s."lastSeen" >= ${since}
      ORDER BY s."lastSeen" DESC
      LIMIT ${limitNum}
    `;

    return {
      success: true,
      data: users.map((u) => ({
        id: u.id,
        phoneNumber: u.phoneNumber,
        name: u.name,
        isActive: u.isActive,
        status: u.status,
        lastMessageAt: u.lastMessageAt,
        messageCount: u.messageCount || 0,
      })),
      total: users.length,
    };
  }

  /**
   * Bloqueia/desbloqueia usuário
   * POST /admin/users/block
   */
  @Post('users/block')
  @HttpCode(HttpStatus.OK)
  async blockUser(@Body() dto: { userId: string; isBlocked: boolean; reason?: string }) {
    this.logger.warn(
      `Alterando bloqueio do usuário: ${dto.userId} -> isBlocked: ${dto.isBlocked} (motivo: ${dto.reason || 'N/A'})`,
    );

    // Buscar usuário pelo gastoCertoId
    const user = await this.prisma.userCache.findFirst({
      where: { gastoCertoId: dto.userId },
    });

    if (!user) {
      throw new BadRequestException(`Usuário não encontrado: ${dto.userId}`);
    }

    // Atualizar status de bloqueio no userCache (banco)
    await this.prisma.userCache.update({
      where: { id: user.id },
      data: {
        isBlocked: dto.isBlocked,
        updatedAt: new Date(),
      },
    });

    // 🆕 ATUALIZAR CACHE REDIS
    this.logger.log(`🔄 Atualizando cache Redis para ${user.phoneNumber}`);
    await this.cacheService.invalidateUser(user.phoneNumber);

    // Invalidar também pelo telegramId se existir
    if (user.telegramId) {
      this.logger.log(`🔄 Invalidando cache Redis também pelo telegramId: ${user.telegramId}`);
      await this.cacheService.invalidateUser(user.telegramId);
    }

    // Se estiver bloqueando, também desativar a sessão WhatsApp
    if (dto.isBlocked) {
      // Buscar sessão ativa do usuário
      const session = await this.prisma.whatsAppSession.findFirst({
        where: { phoneNumber: user.phoneNumber },
        orderBy: { updatedAt: 'desc' },
      });

      if (session) {
        await this.prisma.whatsAppSession.update({
          where: { id: session.id },
          data: {
            isActive: false,
            status: 'DISCONNECTED',
            updatedAt: new Date(),
          },
        });

        await this.sessionManager.stopSession(session.sessionId);
      }
    }

    return {
      success: true,
      message: `Usuário ${dto.userId} ${dto.isBlocked ? 'bloqueado' : 'desbloqueado'} com sucesso`,
    };
  }

  /**
   * Ativa/desativa usuário
   * POST /admin/users/activate
   */
  @Post('users/activate')
  @HttpCode(HttpStatus.OK)
  async activateUser(@Body() dto: { userId: string; isActive: boolean }) {
    this.logger.log(
      `
========================================
🔧 [ADMIN] ATIVAR/DESATIVAR USUÁRIO
========================================
UserId: ${dto.userId}
isActive: ${dto.isActive}
========================================`,
    );

    // Buscar usuário pelo gastoCertoId
    const user = await this.prisma.userCache.findFirst({
      where: { gastoCertoId: dto.userId },
    });

    this.logger.log(
      `📊 Usuário encontrado no banco:\n` +
        `  - phoneNumber: ${user?.phoneNumber}\n` +
        `  - telegramId: ${user?.telegramId}\n` +
        `  - name: ${user?.name}\n` +
        `  - isActive (antes): ${user?.isActive}\n` +
        `  - isBlocked: ${user?.isBlocked}`,
    );

    if (!user) {
      throw new BadRequestException(`Usuário não encontrado: ${dto.userId}`);
    }

    // Atualizar status ativo no userCache (banco)
    await this.prisma.userCache.update({
      where: { id: user.id },
      data: {
        isActive: dto.isActive,
        updatedAt: new Date(),
      },
    });

    this.logger.log(`✅ Status atualizado no banco: isActive = ${dto.isActive}`);

    // 🆕 ATUALIZAR CACHE REDIS
    this.logger.log(`🔄 Invalidando cache Redis para ${user.phoneNumber}`);
    await this.cacheService.invalidateUser(user.phoneNumber);
    this.logger.log(`✅ Cache Redis invalidado`);

    // 🆕 COMPLETAR ONBOARDING PENDENTE ao ativar usuário
    if (dto.isActive) {
      this.logger.log(`🔍 Buscando sessões de onboarding pendentes...`);

      // Completar qualquer sessão de onboarding pendente
      const onboardingSession = await this.prisma.onboardingSession.findFirst({
        where: {
          platformId: user.phoneNumber,
          completed: false,
        },
      });

      if (onboardingSession) {
        this.logger.log(
          `🎯 Sessão de onboarding PENDENTE encontrada (phoneNumber):\n` +
            `  - id: ${onboardingSession.id}\n` +
            `  - platformId: ${onboardingSession.platformId}\n` +
            `  - currentStep: ${onboardingSession.currentStep}\n` +
            `  - completed (antes): ${onboardingSession.completed}`,
        );

        await this.prisma.onboardingSession.update({
          where: { id: onboardingSession.id },
          data: {
            completed: true,
            currentStep: 'COMPLETED',
            updatedAt: new Date(),
          },
        });

        this.logger.log(`✅ Sessão de onboarding finalizada (phoneNumber)`);
      } else {
        this.logger.log(`ℹ️ Nenhuma sessão de onboarding pendente encontrada (phoneNumber)`);
      }

      // Buscar também por telegramId se for Telegram
      if (user.telegramId) {
        this.logger.log(`🔍 Buscando sessão de onboarding Telegram (ID: ${user.telegramId})...`);

        const telegramOnboarding = await this.prisma.onboardingSession.findFirst({
          where: {
            platformId: user.telegramId,
            completed: false,
          },
        });

        if (telegramOnboarding) {
          this.logger.log(
            `🎯 Sessão de onboarding Telegram PENDENTE encontrada:\n` +
              `  - id: ${telegramOnboarding.id}\n` +
              `  - platformId: ${telegramOnboarding.platformId}\n` +
              `  - currentStep: ${telegramOnboarding.currentStep}\n` +
              `  - completed (antes): ${telegramOnboarding.completed}`,
          );

          await this.prisma.onboardingSession.update({
            where: { id: telegramOnboarding.id },
            data: {
              completed: true,
              currentStep: 'COMPLETED',
              updatedAt: new Date(),
            },
          });

          this.logger.log(`✅ Sessão de onboarding Telegram finalizada`);
        } else {
          this.logger.log(`ℹ️ Nenhuma sessão de onboarding Telegram pendente encontrada`);
        }
      }

      this.logger.log(
        `========================================\n✅ ONBOARDING FINALIZADO\n========================================`,
      );
    }

    // Se estiver ativando, também ativar a sessão WhatsApp
    if (dto.isActive) {
      // Buscar sessão ativa do usuário
      const session = await this.prisma.whatsAppSession.findFirst({
        where: { phoneNumber: user.phoneNumber },
        orderBy: { updatedAt: 'desc' },
      });

      if (session) {
        await this.prisma.whatsAppSession.update({
          where: { id: session.id },
          data: {
            isActive: true,
            status: 'DISCONNECTED',
            updatedAt: new Date(),
          },
        });

        await this.sessionManager.startSession(session.sessionId);
      }
    } else {
      // Se estiver desativando, parar a sessão WhatsApp
      const session = await this.prisma.whatsAppSession.findFirst({
        where: { phoneNumber: user.phoneNumber },
        orderBy: { updatedAt: 'desc' },
      });

      if (session) {
        await this.prisma.whatsAppSession.update({
          where: { id: session.id },
          data: {
            isActive: false,
            status: 'DISCONNECTED',
            updatedAt: new Date(),
          },
        });

        await this.sessionManager.stopSession(session.sessionId);
      }
    }

    return {
      success: true,
      message: `Usuário ${dto.userId} ${dto.isActive ? 'ativado' : 'desativado'} com sucesso`,
    };
  }

  /**
   * Onboarding manual de usuário
   * POST /admin/onboarding/manual
   */
  @Post('onboarding/manual')
  @HttpCode(HttpStatus.CREATED)
  async manualOnboarding(
    @Body() dto: { phoneNumber: string; name: string; email: string; notes?: string },
  ) {
    this.logger.log(`Onboarding manual: ${dto.phoneNumber} (${dto.name})`);

    if (!dto.phoneNumber || !dto.name || !dto.email) {
      throw new BadRequestException('phoneNumber, name e email são obrigatórios');
    }

    this.logger.log(`TODO: Criar usuário na API GastoCerto`);
    this.logger.log(`- Phone: ${dto.phoneNumber}`);
    this.logger.log(`- Name: ${dto.name}`);
    this.logger.log(`- Email: ${dto.email}`);
    this.logger.log(`- Notes: ${dto.notes || 'N/A'}`);

    return {
      success: true,
      message: `Onboarding manual enfileirado para ${dto.phoneNumber}`,
    };
  }

  /**
   * Health check do sistema
   * GET /admin/health
   */
  @Get('health')
  async healthCheck() {
    const [
      totalSessions,
      activeSessions,
      connectedSessions,
      telegramSessions,
      totalUsersCount,
      activeUsersCount,
      onboardingCompletedCount,
      onboardingPendingCount,
      aiProvidersCount,
    ] = await Promise.all([
      this.sessionsService.countSessions(),
      this.sessionsService.getActiveSessions(),
      this.sessionsService.getConnectedSessions(),
      this.telegramSessionsService.findAll(),
      // Total de usuários no cache
      this.prisma.userCache.count(),
      // Contar usuários ativos (cache Redis)
      this.cacheService.countActiveUsers(),
      // Onboarding completo
      this.prisma.onboardingSession.count({
        where: { completed: true },
      }),
      // Onboarding pendente (não expirado)
      this.prisma.onboardingSession.count({
        where: {
          completed: false,
          expiresAt: { gt: new Date() },
        },
      }),
      // Contar providers de IA ativos
      this.prisma.aIProviderConfig.count({
        where: { enabled: true },
      }),
    ]);

    const activeProviders = this.sessionManager['sessions']?.size || 0;

    // Separar sessões do Telegram por status
    const telegramStats = {
      total: telegramSessions.length,
      active: telegramSessions.filter((s) => s.isActive).length,
      connected: telegramSessions.filter((s) => s.status === 'CONNECTED').length,
      disconnected: telegramSessions.filter((s) => s.status === 'DISCONNECTED').length,
      connecting: telegramSessions.filter((s) => s.status === 'CONNECTING').length,
    };

    return {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      whatsapp: {
        total: totalSessions,
        active: activeSessions.length,
        connected: connectedSessions.length,
      },
      telegram: telegramStats,
      providers: {
        active: aiProvidersCount,
      },
      users: {
        total: totalUsersCount,
        active: activeUsersCount,
      },
      onboarding: {
        completed: onboardingCompletedCount,
        pending: onboardingPendingCount,
      },
      service: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
      },
    };
  }

  /**
   * Consultar logs de busca RAG (analytics) - ATUALIZADO
   * GET /admin/rag/search-logs?userId=xxx&failedOnly=true&limit=20&offset=0
   */
  @Get('rag/search-logs')
  async getRagSearchLogs(
    @Query('userId') userId?: string,
    @Query('failedOnly') failedOnly?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    this.logger.log('📊 Admin solicitou logs de busca RAG');

    try {
      const failedFilter = failedOnly === 'true';
      const limitNum = Math.min(parseInt(limit || '20'), 100); // Máximo 100 por página
      const offsetNum = parseInt(offset || '0');

      // Buscar logs via RAGService com paginação
      const result = await this.ragService.getSearchAttempts(
        userId || null,
        failedFilter,
        limitNum,
        offsetNum,
      );

      // 🆕 Enriquecer logs com userName
      const enrichedLogs = await Promise.all(
        result.logs.map(async (log) => {
          const user = await this.cacheService.getUserByGastoCertoId(log.userId);
          return {
            ...log,
            userName: user?.name || 'Desconhecido',
          };
        }),
      );

      // Calcular estatísticas detalhadas
      const successfulAttempts = result.logs.filter((log) => log.success).length;
      const failedAttempts = result.logs.length - successfulAttempts;
      const successRate =
        result.logs.length > 0
          ? ((successfulAttempts / result.logs.length) * 100).toFixed(2)
          : '0.00';

      // 🆕 Estatísticas de AI Fallback
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

      // Top queries que falharam (apenas na página atual)
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

      // 🆕 Estatísticas por provider de AI
      const aiProviderStats = logsWithDetails
        .filter((log) => log.aiProvider)
        .reduce(
          (acc, log) => {
            const provider = log.aiProvider || 'unknown';
            if (!acc[provider]) {
              acc[provider] = { count: 0, models: new Set() };
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
      this.logger.error('❌ Erro ao buscar logs RAG:', error);

      return {
        success: false,
        message: 'Erro ao buscar logs RAG',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * 🆕 Consultar TODOS os detalhes de um log RAG específico
   * GET /admin/rag/search-logs/:id/details
   * Retorna: RAG log completo + dados do usuário + transação vinculada + logs de IA
   */
  @Get('rag/search-logs/:id/details')
  async getRagSearchLogDetail(@Param('id') id: string) {
    this.logger.log(`📋 Admin solicitou detalhes COMPLETOS do log RAG: ${id}`);

    try {
      // Buscar log RAG completo
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

      // Buscar dados do usuário
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

      // Buscar transações vinculadas (relacionamento reverso)
      const transactions = await this.prisma.transactionConfirmation.findMany({
        where: {
          ragSearchLogId: id,
        },
        orderBy: { createdAt: 'desc' },
        take: 10, // Limitar a 10 transações mais recentes
      });

      // Buscar logs de AI relacionados (TODOS os campos)
      const aiLogs = await this.prisma.aIUsageLog.findMany({
        where: { ragSearchLogId: id },
        orderBy: { createdAt: 'asc' },
      });

      // Buscar sinônimos do usuário relacionados ao termo buscado
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
          // Dados completos do RAG log
          ragLog: log,

          // Dados do usuário
          user: userData,

          // Transações vinculadas (relacionamento reverso)
          transactions: transactions,

          // Logs de IA vinculados
          aiUsageLogs: aiLogs,
          aiUsageStats: {
            totalLogs: aiLogs.length,
            totalTokens: aiLogs.reduce((sum, log) => sum + (log.totalTokens || 0), 0),
            totalCost: aiLogs.reduce(
              (sum, log) => sum + (log.estimatedCost ? Number(log.estimatedCost) : 0),
              0,
            ),
            providers: [...new Set(aiLogs.map((l) => l.provider))],
            models: [...new Set(aiLogs.map((l) => l.model))],
          },

          // Sinônimos do usuário relacionados
          relatedSynonyms: userSynonyms,

          // Análise do RAG
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
      this.logger.error('❌ Erro ao buscar detalhes completos do log RAG:', error);

      return {
        success: false,
        message: 'Erro ao buscar detalhes do log RAG',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * 📊 Estatísticas gerais do RAG
   * GET /admin/rag/stats?year=2026&month=1
   * GET /admin/rag/stats?days=7
   *
   * Query params:
   * - year: Ano (ex: 2026) - Filtra por ano inteiro
   * - month: Mês (1-12) - Requer year, filtra por mês específico
   * - days: Dias (ex: 7, 30) - Período em dias (ignorado se year/month presentes)
   *
   * @returns Estatísticas completas do RAG incluindo:
   * - Total de buscas e taxa de sucesso
   * - AI Fallback (quando RAG falha)
   * - Scores médios e tempo de resposta
   * - Top usuários e queries
   * - Distribuição por flowStep
   * - Queries mais frequentes
   * - Categorias mais buscadas
   */
  @Get('rag/stats')
  async getRagStats(
    @Query('year') year?: string,
    @Query('month') month?: string,
    @Query('days') days?: string,
  ) {
    this.logger.log('📊 Admin solicitou estatísticas gerais do RAG');

    try {
      let startDate: Date;
      let endDate: Date;
      let periodLabel: string;

      // Prioridade: year/month > days
      if (year) {
        const yearNum = parseInt(year);

        if (month) {
          // Filtro por ano + mês específico
          const monthNum = parseInt(month);
          startDate = new Date(yearNum, monthNum - 1, 1); // Primeiro dia do mês
          endDate = new Date(yearNum, monthNum, 0, 23, 59, 59, 999); // Último dia do mês
          periodLabel = `${monthNum.toString().padStart(2, '0')}/${yearNum}`;
        } else {
          // Filtro por ano inteiro
          startDate = new Date(yearNum, 0, 1); // 01/01/YEAR
          endDate = new Date(yearNum, 11, 31, 23, 59, 59, 999); // 31/12/YEAR
          periodLabel = yearNum.toString();
        }
      } else {
        // Fallback: últimos N dias
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

      // Total de buscas
      const totalSearches = await this.prisma.rAGSearchLog.count({
        where: whereClause,
      });

      // Buscas bem-sucedidas
      const successfulSearches = await this.prisma.rAGSearchLog.count({
        where: {
          ...whereClause,
          success: true,
        },
      });

      // Buscas com AI Fallback
      const aiFallbackSearches = await this.prisma.rAGSearchLog.count({
        where: {
          ...whereClause,
          wasAiFallback: true,
        },
      });

      // Média de score RAG
      const avgScore = await this.prisma.rAGSearchLog.aggregate({
        where: whereClause,
        _avg: { ragInitialScore: true },
      });

      // Tempo médio de resposta
      const avgResponseTime = await this.prisma.rAGSearchLog.aggregate({
        where: whereClause,
        _avg: { responseTime: true },
      });

      // Top usuários usando RAG
      const topUsersRaw = await this.prisma.rAGSearchLog.groupBy({
        by: ['userId'],
        where: whereClause,
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      });

      // Enriquecer com userName
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

      // Queries que mais precisam de sinônimos
      const needsSynonymLearning = await this.prisma.aIUsageLog.count({
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
          needsSynonymLearning: true,
        },
      });

      // Distribuição por flowStep
      const flowStepDistribution = await this.prisma.rAGSearchLog.groupBy({
        by: ['flowStep', 'totalSteps'],
        where: whereClause,
        _count: { id: true },
        orderBy: { flowStep: 'asc' },
      });

      // Top queries (mais frequentes)
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

      // Top queries que falharam
      const topFailedQueriesRaw = await this.prisma.rAGSearchLog.groupBy({
        by: ['query'],
        where: {
          ...whereClause,
          success: false,
        },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 20,
      });

      const topFailedQueries = topFailedQueriesRaw.map((q) => ({
        query: q.query,
        count: q._count.id,
      }));

      // Top categorias encontradas
      const topCategoriesRaw = await this.prisma.rAGSearchLog.groupBy({
        by: ['bestMatch'],
        where: {
          ...whereClause,
          success: true,
          bestMatch: { not: null },
        },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 20,
      });

      const topCategories = topCategoriesRaw.map((c) => ({
        category: c.bestMatch || 'Desconhecida',
        count: c._count.id,
      }));

      // Distribuição por ragMode
      const ragModeDistribution = await this.prisma.rAGSearchLog.groupBy({
        by: ['ragMode'],
        where: whereClause,
        _count: { id: true },
      });

      // Custos de IA (se houver)
      const aiCosts = await this.prisma.aIUsageLog.aggregate({
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
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
      this.logger.error('❌ Erro ao buscar estatísticas RAG:', error);

      return {
        success: false,
        message: 'Erro ao buscar estatísticas RAG',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * 🆕 Revalidar mensagem de usuário sem gerar log RAG
   * POST /admin/rag/revalidate
   * Body: { userId: string, message: string }
   */
  @Post('rag/revalidate')
  async revalidateUserMessage(@Body() body: { userId: string; message: string }) {
    this.logger.log(`🔄 Admin revalidando mensagem do usuário: ${body.userId}`);

    try {
      // Buscar usuário
      const user = await this.cacheService.getUser(body.userId);
      if (!user) {
        return {
          success: false,
          message: 'Usuário não encontrado',
          timestamp: new Date().toISOString(),
        };
      }

      // Buscar categorias com skipLogging=true
      const matches = await this.ragService.findSimilarCategories(body.message, user.gastoCertoId, {
        skipLogging: true,
      });

      return {
        success: true,
        data: {
          userId: body.userId,
          message: body.message,
          matches,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error: any) {
      this.logger.error('❌ Erro ao revalidar mensagem:', error);

      return {
        success: false,
        message: 'Erro ao revalidar mensagem',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * 🆕 Adicionar termo aos sinônimos globais
   * POST /admin/rag/global-synonyms
   * Body: { term: string, targetCategory: string, targetSubCategory?: string }
   */
  @Post('rag/global-synonyms')
  async addGlobalSynonym(
    @Body()
    body: {
      term: string;
      targetCategory: string;
      targetSubCategory?: string;
    },
  ) {
    this.logger.log(`➕ Admin adicionando sinônimo global: ${body.term} → ${body.targetCategory}`);

    try {
      // Criar sinônimo global (userId = null)
      // categoryId é opcional - matching é feito por categoryName
      const synonym = await this.prisma.userSynonym.create({
        data: {
          userId: null,
          keyword: body.term.toLowerCase().trim(),
          categoryId: null, // Sinônimos globais não usam ID - matching por nome
          categoryName: body.targetCategory,
          subCategoryId: null,
          subCategoryName: body.targetSubCategory || null,
          confidence: 1.0,
          source: 'ADMIN_APPROVED',
        },
      });

      // Limpar cache do RAG para forçar reindexação
      await this.ragService.clearCache();

      return {
        success: true,
        data: synonym,
        message: 'Sinônimo global adicionado com sucesso',
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      this.logger.error('❌ Erro ao adicionar sinônimo global:', error);

      return {
        success: false,
        message: 'Erro ao adicionar sinônimo global',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * 🆕 Listar logs RAG por usuário específico
   * GET /admin/rag/user-logs/:userId?limit=50
   */
  @Get('rag/user-logs/:userId')
  async getUserRagLogs(
    @Param('userId') userId: string,
    @Query('limit') limit?: string,
    @Query('onlyFailed') onlyFailed?: string,
  ) {
    this.logger.log(`📋 Admin solicitou logs RAG do usuário: ${userId}`);

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

      // Buscar informações do usuário
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
      this.logger.error('❌ Erro ao buscar logs do usuário:', error);

      return {
        success: false,
        message: 'Erro ao buscar logs do usuário',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * 🆕 Listar sessões de onboarding ativas e recentes
   * GET /admin/onboarding/sessions?status=active&limit=50
   */
  @Get('onboarding/sessions')
  async getOnboardingSessions(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('platform') platform?: string,
  ) {
    this.logger.log('📋 Admin solicitou sessões de onboarding');

    try {
      const limitNum = Math.min(parseInt(limit || '50'), 200);
      const now = new Date();

      // Filtros dinâmicos
      const where: any = {};

      if (status === 'active') {
        where.completed = false;
        where.expiresAt = { gt: now };
      } else if (status === 'expired') {
        where.completed = false;
        where.expiresAt = { lte: now };
      } else if (status === 'completed') {
        where.completed = true;
      }

      if (platform) {
        // Filtrar por prefixo do platformId (telegram: chatId numérico, whatsapp: +55...)
        if (platform === 'telegram') {
          where.platformId = { not: { startsWith: '+' } };
        } else if (platform === 'whatsapp') {
          where.platformId = { startsWith: '+' };
        }
      }

      const sessions = await this.prisma.onboardingSession.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: limitNum,
      });

      // Contar totais
      const totalActive = await this.prisma.onboardingSession.count({
        where: { completed: false, expiresAt: { gt: now } },
      });

      const totalExpired = await this.prisma.onboardingSession.count({
        where: { completed: false, expiresAt: { lte: now } },
      });

      const totalCompleted = await this.prisma.onboardingSession.count({
        where: { completed: true },
      });

      // Estatísticas por step
      const stepDistribution = await this.prisma.onboardingSession.groupBy({
        by: ['currentStep'],
        where: { completed: false },
        _count: { id: true },
      });

      return {
        success: true,
        data: sessions.map((session) => ({
          id: session.id,
          platformId: session.platformId,
          phoneNumber: session.phoneNumber,
          currentStep: session.currentStep,
          attempts: session.attempts,
          lastMessageAt: session.lastMessageAt,
          expiresAt: session.expiresAt,
          isExpired: session.expiresAt < now,
          completed: session.completed,
          data: session.data, // 🆕 Adicionar campo data (JSON) para mostrar dados coletados
          minutesSinceLastMessage: Math.floor(
            (now.getTime() - session.lastMessageAt.getTime()) / 60000,
          ),
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        })),
        stats: {
          totalActive,
          totalExpired,
          totalCompleted,
          totalAll: totalActive + totalExpired + totalCompleted,
          stepDistribution: stepDistribution.map((s) => ({
            step: s.currentStep,
            count: s._count.id,
          })),
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      this.logger.error('❌ Erro ao buscar sessões de onboarding:', error);

      return {
        success: false,
        message: 'Erro ao buscar sessões de onboarding',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * 🆕 Detalhes de uma sessão de onboarding específica
   * GET /admin/onboarding/sessions/:id
   */
  @Get('onboarding/sessions/:id')
  async getOnboardingSessionDetail(@Param('id') id: string) {
    this.logger.log(`📋 Admin solicitou detalhes da sessão: ${id}`);

    try {
      const session = await this.prisma.onboardingSession.findUnique({
        where: { id },
      });

      if (!session) {
        return {
          success: false,
          message: 'Sessão não encontrada',
          timestamp: new Date().toISOString(),
        };
      }

      const now = new Date();

      return {
        success: true,
        data: {
          ...session,
          isExpired: session.expiresAt < now,
          minutesSinceLastMessage: Math.floor(
            (now.getTime() - session.lastMessageAt.getTime()) / 60000,
          ),
          data: session.data, // JSON com dados coletados
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      this.logger.error('❌ Erro ao buscar detalhes da sessão:', error);

      return {
        success: false,
        message: 'Erro ao buscar detalhes da sessão',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Deleta logs de busca RAG
   * DELETE /admin/rag/search-logs
   */
  @Delete('rag/search-logs')
  @HttpCode(HttpStatus.OK)
  async deleteRagSearchLogs(@Body() dto: { ids: string[] }) {
    this.logger.log(`🗑️ Admin solicitou exclusão de ${dto.ids?.length || 0} logs RAG`);
    this.logger.debug(`IDs para deletar: ${JSON.stringify(dto.ids)}`);

    try {
      if (!dto.ids || !Array.isArray(dto.ids) || dto.ids.length === 0) {
        throw new BadRequestException('IDs são obrigatórios e devem ser um array não vazio');
      }

      const result = await this.ragService.deleteSearchLogs(dto.ids);

      this.logger.log(`✅ Deletados ${result.deletedCount} de ${dto.ids.length} logs solicitados`);

      return {
        success: true,
        message: `${result.deletedCount} logs deletados com sucesso`,
        deletedCount: result.deletedCount,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      this.logger.error('❌ Erro ao deletar logs RAG:', error);

      return {
        success: false,
        message: 'Erro ao deletar logs RAG',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  // ========================================
  // 🎯 SINÔNIMOS - GERENCIAMENTO
  // ========================================

  /**
   * Ver sugestões de sinônimos para aprender
   * GET /admin/synonyms/learning-suggestions
   *
   * Analisa logs de AI onde RAG falhou mas AI teve sucesso,
   * agrupa por keyword e sugere criação de sinônimos.
   */
  @Get('synonyms/learning-suggestions')
  async getSynonymLearningSuggestions(
    @Query('limit') limit?: string,
    @Query('minOccurrences') minOccurrences?: string,
    @Query('minAiConfidence') minAiConfidence?: string,
  ) {
    this.logger.log('📚 Admin solicitou sugestões de aprendizado de sinônimos');

    try {
      const limitNum = parseInt(limit) || 50;
      const minOccur = parseInt(minOccurrences) || 3;
      const minConf = parseFloat(minAiConfidence) || 0.7;

      // Buscar logs de AI onde needsSynonymLearning = true
      const aiLogsWithLearning = await this.prisma.aIUsageLog.findMany({
        where: {
          needsSynonymLearning: true,
          aiConfidence: {
            gte: minConf,
          },
        },
        select: {
          ragSearchLogId: true,
          aiCategoryId: true,
          aiCategoryName: true,
          finalCategoryId: true,
          finalCategoryName: true,
          aiConfidence: true,
          metadata: true, // Contém subCategoryId e subCategoryName
          createdAt: true,
          ragSearchLog: {
            select: {
              userId: true,
              query: true,
              queryNormalized: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 1000, // Buscar bastante para agrupar
      });

      // Agrupar por keyword normalizada
      const grouped = new Map<
        string,
        {
          keyword: string;
          users: Set<string>;
          occurrences: number;
          suggestedCategoryId?: string;
          suggestedCategoryName: string;
          suggestedSubCategoryName?: string;
          totalAiConfidence: number;
          lastUsedAt: Date;
          exampleQueries: string[];
        }
      >();

      for (const log of aiLogsWithLearning) {
        if (!log.ragSearchLog) continue;

        const keyword = log.ragSearchLog.queryNormalized;
        const userId = log.ragSearchLog.userId;
        const categoryName = log.aiCategoryName || log.finalCategoryName;

        // Extrair subcategoria do metadata
        const metadata = log.metadata as any;
        const subCategoryName = metadata?.subCategoryName || metadata?.subCategory?.name;

        if (!keyword || !categoryName) continue;

        if (!grouped.has(keyword)) {
          grouped.set(keyword, {
            keyword,
            users: new Set([userId]),
            occurrences: 1,
            suggestedCategoryId: log.aiCategoryId || log.finalCategoryId,
            suggestedCategoryName: categoryName,
            suggestedSubCategoryName: subCategoryName,
            totalAiConfidence: Number(log.aiConfidence),
            lastUsedAt: log.createdAt,
            exampleQueries: [log.ragSearchLog.query],
          });
        } else {
          const entry = grouped.get(keyword);
          entry.users.add(userId);
          entry.occurrences++;
          entry.totalAiConfidence += Number(log.aiConfidence);

          if (log.createdAt > entry.lastUsedAt) {
            entry.lastUsedAt = log.createdAt;
          }

          // Adicionar query de exemplo se não tiver ainda
          if (
            entry.exampleQueries.length < 3 &&
            !entry.exampleQueries.includes(log.ragSearchLog.query)
          ) {
            entry.exampleQueries.push(log.ragSearchLog.query);
          }
        }
      }

      // Filtrar por mínimo de ocorrências e ordenar COM INFO DO USUÁRIO
      const suggestions = await Promise.all(
        Array.from(grouped.values())
          .filter((entry) => entry.occurrences >= minOccur)
          .map(async (entry) => {
            // Buscar info dos usuários que usaram essa keyword
            const userIds = Array.from(entry.users);
            const users = await this.prisma.userCache.findMany({
              where: {
                gastoCertoId: {
                  in: userIds,
                },
              },
              select: {
                gastoCertoId: true,
                name: true,
                phoneNumber: true,
              },
              take: 5, // Limitar a 5 usuários por sugestão
            });

            return {
              keyword: entry.keyword,
              userCount: entry.users.size,
              totalOccurrences: entry.occurrences,
              suggestedCategoryId: entry.suggestedCategoryId,
              suggestedCategoryName: entry.suggestedCategoryName,
              suggestedSubCategoryName: entry.suggestedSubCategoryName,
              avgAiConfidence: entry.totalAiConfidence / entry.occurrences,
              lastUsedAt: entry.lastUsedAt,
              exampleQueries: entry.exampleQueries,
              users, // Incluir info dos usuários
            };
          }),
      );

      const sortedSuggestions = suggestions
        .sort((a, b) => b.totalOccurrences - a.totalOccurrences)
        .slice(0, limitNum);

      return {
        success: true,
        suggestions: sortedSuggestions,
        total: sortedSuggestions.length,
        filters: {
          minOccurrences: minOccur,
          minAiConfidence: minConf,
          limit: limitNum,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      this.logger.error('❌ Erro ao buscar sugestões de sinônimos:', error);

      return {
        success: false,
        message: 'Erro ao buscar sugestões de sinônimos',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Listar todos os sinônimos com paginação e filtros
   * GET /admin/synonyms
   */
  @Get('synonyms')
  async listSynonyms(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sortBy') sortBy?: string,
    @Query('order') order?: string,
    @Query('source') source?: string,
    @Query('userId') userId?: string,
    @Query('keyword') keyword?: string,
  ) {
    this.logger.log('📋 Admin solicitou lista de sinônimos');

    try {
      const pageNum = parseInt(page || '1');
      const limitNum = parseInt(limit || '20');
      const skip = (pageNum - 1) * limitNum;
      const sortField = sortBy || 'createdAt';
      const sortOrder = order === 'asc' ? 'asc' : 'desc';

      // Construir filtros
      const where: any = {};

      if (source) {
        where.source = source;
      }

      if (userId) {
        where.userId = userId;
      }

      if (keyword) {
        where.keyword = {
          contains: keyword,
          mode: 'insensitive',
        };
      }

      // Buscar sinônimos com dados do usuário via relacionamento Prisma
      const [synonyms, total] = await Promise.all([
        this.prisma.userSynonym.findMany({
          where,
          orderBy: {
            [sortField]: sortOrder,
          },
          skip,
          take: limitNum,
          select: {
            id: true,
            userId: true,
            keyword: true,
            categoryName: true,
            subCategoryName: true,
            confidence: true,
            source: true,
            usageCount: true,
            lastUsedAt: true,
            createdAt: true,
            updatedAt: true,
            user: {
              select: {
                gastoCertoId: true,
                name: true,
                email: true,
              },
            },
          },
        }),
        this.prisma.userSynonym.count({ where }),
      ]);

      const totalPages = Math.ceil(total / limitNum);

      this.logger.log(
        `✅ Retornando ${synonyms.length} sinônimos (página ${pageNum}/${totalPages})`,
      );

      return {
        success: true,
        data: synonyms,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages,
          hasNextPage: pageNum < totalPages,
          hasPreviousPage: pageNum > 1,
        },
        filters: {
          source,
          userId,
          keyword,
          sortBy: sortField,
          order: sortOrder,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      this.logger.error('❌ Erro ao listar sinônimos:', error);

      return {
        success: false,
        message: 'Erro ao listar sinônimos',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Criar novo sinônimo
   * POST /admin/synonyms
   */
  @Post('synonyms')
  @HttpCode(HttpStatus.CREATED)
  async createSynonym(
    @Body()
    dto: {
      userId: string;
      keyword: string;
      categoryId: string;
      categoryName: string;
      subCategoryId?: string;
      subCategoryName?: string;
      confidence?: number;
      source?: 'USER_CONFIRMED' | 'AI_SUGGESTED' | 'AUTO_LEARNED' | 'IMPORTED' | 'ADMIN_APPROVED';
    },
  ) {
    this.logger.log(`🎯 Admin criando sinônimo: "${dto.keyword}" → ${dto.categoryName}`);

    try {
      // Validações
      if (!dto.userId || !dto.keyword || !dto.categoryId || !dto.categoryName) {
        throw new BadRequestException(
          'userId, keyword, categoryId e categoryName são obrigatórios',
        );
      }

      await this.ragService.addUserSynonym({
        userId: dto.userId,
        keyword: dto.keyword,
        categoryId: dto.categoryId,
        categoryName: dto.categoryName,
        subCategoryId: dto.subCategoryId,
        subCategoryName: dto.subCategoryName,
        confidence: dto.confidence ?? 1.0,
        source: dto.source ?? 'ADMIN_APPROVED',
      });

      return {
        success: true,
        message: 'Sinônimo criado com sucesso',
        data: {
          keyword: dto.keyword,
          categoryName: dto.categoryName,
          subCategoryName: dto.subCategoryName,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      this.logger.error('❌ Erro ao criar sinônimo:', error);

      return {
        success: false,
        message: 'Erro ao criar sinônimo',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Criar múltiplos sinônimos em batch
   * POST /admin/synonyms/batch
   */
  @Post('synonyms/batch')
  @HttpCode(HttpStatus.CREATED)
  async createSynonymsBatch(
    @Body()
    dto: {
      synonyms: Array<{
        userId: string;
        keyword: string;
        categoryId: string;
        categoryName: string;
        subCategoryId?: string;
        subCategoryName?: string;
        confidence?: number;
        source?: 'USER_CONFIRMED' | 'AI_SUGGESTED' | 'AUTO_LEARNED' | 'IMPORTED' | 'ADMIN_APPROVED';
      }>;
    },
  ) {
    this.logger.log(`🎯 Admin criando ${dto.synonyms?.length || 0} sinônimos em batch`);

    try {
      if (!dto.synonyms || !Array.isArray(dto.synonyms) || dto.synonyms.length === 0) {
        throw new BadRequestException('Array de sinônimos é obrigatório');
      }

      const results = {
        created: 0,
        failed: 0,
        errors: [] as Array<{ keyword: string; error: string }>,
      };

      for (const synonym of dto.synonyms) {
        try {
          await this.ragService.addUserSynonym({
            userId: synonym.userId,
            keyword: synonym.keyword,
            categoryId: synonym.categoryId,
            categoryName: synonym.categoryName,
            subCategoryId: synonym.subCategoryId,
            subCategoryName: synonym.subCategoryName,
            confidence: synonym.confidence ?? 1.0,
            source: synonym.source ?? 'ADMIN_APPROVED',
          });
          results.created++;
        } catch (error: any) {
          results.failed++;
          results.errors.push({
            keyword: synonym.keyword,
            error: error.message,
          });
        }
      }

      return {
        success: true,
        message: `${results.created} sinônimos criados, ${results.failed} falharam`,
        ...results,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      this.logger.error('❌ Erro ao criar sinônimos em batch:', error);

      return {
        success: false,
        message: 'Erro ao criar sinônimos em batch',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Criar sinônimo global para todos usuários
   * POST /admin/synonyms/global
   */
  @Post('synonyms/global')
  @HttpCode(HttpStatus.CREATED)
  async createGlobalSynonym(
    @Body()
    dto: {
      keyword: string;
      categoryId: string;
      categoryName: string;
      subCategoryId?: string;
      subCategoryName?: string;
      confidence?: number;
    },
  ) {
    this.logger.log(`🌍 Admin criando sinônimo global: "${dto.keyword}" → ${dto.categoryName}`);

    try {
      // Validações
      if (!dto.keyword || !dto.categoryName) {
        throw new BadRequestException('keyword e categoryName são obrigatórios');
      }

      // categoryId é opcional - se não fornecido, usar vazio
      const categoryId = dto.categoryId || '';
      const subCategoryId = dto.subCategoryId || '';

      // Criar UM ÚNICO sinônimo global (userId = null)
      // Este sinônimo será usado por TODOS os usuários
      const globalSynonym = await this.prisma.userSynonym.create({
        data: {
          userId: null, // NULL = sinônimo global para todos
          keyword: dto.keyword.toLowerCase().trim(),
          categoryId: categoryId,
          categoryName: dto.categoryName,
          subCategoryId: subCategoryId,
          subCategoryName: dto.subCategoryName,
          confidence: dto.confidence ?? 1.0,
          source: 'ADMIN_APPROVED',
        },
      });

      this.logger.log(
        `✅ Sinônimo global criado: ${globalSynonym.id} - "${dto.keyword}" → ${dto.categoryName}`,
      );
      return {
        success: true,
        message: 'Sinônimo global criado com sucesso',
        data: globalSynonym,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      this.logger.error('❌ Erro ao criar sinônimo global:', error);

      return {
        success: false,
        message: 'Erro ao criar sinônimo global',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Listar sinônimos de um usuário
   * GET /admin/synonyms/user/:userId
   */
  @Get('synonyms/user/:userId')
  async getUserSynonyms(
    @Param('userId') userId: string,
    @Query('limit') limit?: string,
    @Query('sortBy') sortBy?: string,
  ) {
    this.logger.log(`📋 Admin solicitou sinônimos do usuário: ${userId}`);

    try {
      const limitNum = parseInt(limit) || 50;
      const sortField = sortBy || 'usageCount';

      const synonyms = await this.prisma.userSynonym.findMany({
        where: { userId },
        orderBy:
          sortField === 'usageCount'
            ? { usageCount: 'desc' }
            : sortField === 'createdAt'
              ? { createdAt: 'desc' }
              : { confidence: 'desc' },
        take: limitNum,
      });

      return {
        success: true,
        data: synonyms,
        total: synonyms.length,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      this.logger.error('❌ Erro ao listar sinônimos do usuário:', error);

      return {
        success: false,
        message: 'Erro ao listar sinônimos do usuário',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Deletar sinônimo
   * DELETE /admin/synonyms/:id
   */
  @Delete('synonyms/:id')
  @HttpCode(HttpStatus.OK)
  async deleteSynonym(@Param('id') id: string) {
    this.logger.log(`🗑️ Admin deletando sinônimo: ${id}`);

    try {
      const synonym = await this.prisma.userSynonym.findUnique({
        where: { id },
        select: {
          userId: true,
          keyword: true,
          categoryName: true,
        },
      });

      if (!synonym) {
        return {
          success: false,
          message: 'Sinônimo não encontrado',
          timestamp: new Date().toISOString(),
        };
      }

      // Buscar dados do usuário
      const user = await this.prisma.userCache.findUnique({
        where: { gastoCertoId: synonym.userId },
        select: {
          gastoCertoId: true,
          name: true,
          phoneNumber: true,
        },
      });

      await this.prisma.userSynonym.delete({
        where: { id },
      });

      this.logger.log(
        `✅ Sinônimo deletado: "${synonym.keyword}" → ${synonym.categoryName} (user: ${user?.name || 'N/A'})`,
      );

      return {
        success: true,
        message: 'Sinônimo deletado com sucesso',
        data: {
          keyword: synonym.keyword,
          categoryName: synonym.categoryName,
          user,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      this.logger.error('❌ Erro ao deletar sinônimo:', error);

      return {
        success: false,
        message: 'Erro ao deletar sinônimo',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Editar sinônimo
   * PUT /admin/synonyms/:id
   */
  @Put('synonyms/:id')
  @HttpCode(HttpStatus.OK)
  async updateSynonym(
    @Param('id') id: string,
    @Body()
    dto: {
      keyword?: string;
      categoryId?: string;
      categoryName?: string;
      subCategoryId?: string;
      subCategoryName?: string;
      confidence?: number;
    },
  ) {
    this.logger.log(`✏️ Admin editando sinônimo: ${id}`);

    try {
      // Verificar se sinônimo existe
      const existing = await this.prisma.userSynonym.findUnique({
        where: { id },
      });

      if (!existing) {
        return {
          success: false,
          message: 'Sinônimo não encontrado',
          timestamp: new Date().toISOString(),
        };
      }

      // Preparar dados para atualização
      const updateData: any = {};

      if (dto.keyword !== undefined) updateData.keyword = dto.keyword;
      if (dto.categoryId !== undefined) updateData.categoryId = dto.categoryId;
      if (dto.categoryName !== undefined) updateData.categoryName = dto.categoryName;
      if (dto.subCategoryId !== undefined) updateData.subCategoryId = dto.subCategoryId;
      if (dto.subCategoryName !== undefined) updateData.subCategoryName = dto.subCategoryName;
      if (dto.confidence !== undefined) updateData.confidence = dto.confidence;

      updateData.updatedAt = new Date();

      const updated = await this.prisma.userSynonym.update({
        where: { id },
        data: updateData,
      });

      // Buscar dados do usuário
      const user = await this.prisma.userCache.findUnique({
        where: { gastoCertoId: updated.userId },
        select: {
          gastoCertoId: true,
          name: true,
          phoneNumber: true,
        },
      });

      this.logger.log(
        `✅ Sinônimo atualizado: "${updated.keyword}" → ${updated.categoryName} (user: ${user?.name || 'N/A'})`,
      );

      return {
        success: true,
        message: 'Sinônimo atualizado com sucesso',
        data: {
          id: updated.id,
          keyword: updated.keyword,
          categoryName: updated.categoryName,
          subCategoryName: updated.subCategoryName,
          categoryId: updated.categoryId,
          subCategoryId: updated.subCategoryId,
          confidence: updated.confidence,
          usageCount: updated.usageCount,
          source: updated.source,
          user,
          updatedAt: updated.updatedAt,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      this.logger.error('❌ Erro ao atualizar sinônimo:', error);

      return {
        success: false,
        message: 'Erro ao atualizar sinônimo',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Estatísticas gerais de sinônimos
   * GET /admin/synonyms/stats
   */
  @Get('synonyms/stats')
  async getSynonymsStats() {
    this.logger.log('📊 Admin solicitou estatísticas de sinônimos');

    try {
      // Total de sinônimos
      const totalSynonyms = await this.prisma.userSynonym.count();

      // Por source
      const bySource = await this.prisma.userSynonym.groupBy({
        by: ['source'],
        _count: {
          id: true,
        },
      });

      // Top keywords (mais usados) COM INFO DO USUÁRIO
      const topKeywordsRaw = await this.prisma.userSynonym.findMany({
        select: {
          id: true,
          userId: true,
          keyword: true,
          usageCount: true,
          categoryName: true,
          subCategoryName: true,
          confidence: true,
          source: true,
          createdAt: true,
          lastUsedAt: true,
          user: {
            select: {
              gastoCertoId: true,
              name: true,
              phoneNumber: true,
            },
          },
        },
        orderBy: {
          usageCount: 'desc',
        },
        take: 10,
      });

      const topKeywords = topKeywordsRaw.map((k) => ({
        id: k.id,
        keyword: k.keyword,
        usageCount: k.usageCount,
        categoryName: k.categoryName,
        subCategoryName: k.subCategoryName,
        confidence: k.confidence,
        source: k.source,
        createdAt: k.createdAt,
        lastUsedAt: k.lastUsedAt,
        user: k.user || null,
      }));

      // Top categorias (com mais sinônimos)
      const categoryGroups = await this.prisma.userSynonym.groupBy({
        by: ['categoryName'],
        _count: {
          id: true,
        },
        orderBy: {
          _count: {
            id: 'desc',
          },
        },
        take: 10,
      });

      // Sinônimos recentes (últimos 7 dias) COM INFO DO USUÁRIO
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const recentSynonymsRaw = await this.prisma.userSynonym.findMany({
        where: {
          createdAt: {
            gte: sevenDaysAgo,
          },
        },
        select: {
          id: true,
          userId: true,
          keyword: true,
          categoryName: true,
          subCategoryName: true,
          usageCount: true,
          source: true,
          createdAt: true,
          user: {
            select: {
              gastoCertoId: true,
              name: true,
              phoneNumber: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        take: 10,
      });

      const recentSynonyms = recentSynonymsRaw.map((s) => ({
        id: s.id,
        keyword: s.keyword,
        categoryName: s.categoryName,
        subCategoryName: s.subCategoryName,
        usageCount: s.usageCount,
        source: s.source,
        createdAt: s.createdAt,
        user: s.user || null,
      }));

      const recentlyCreated = await this.prisma.userSynonym.count({
        where: {
          createdAt: {
            gte: sevenDaysAgo,
          },
        },
      });

      // Oportunidades de aprendizado
      const learningOpportunities = await this.prisma.aIUsageLog.count({
        where: {
          needsSynonymLearning: true,
        },
      });

      return {
        success: true,
        stats: {
          totalSynonyms,
          bySource: Object.fromEntries(bySource.map((s) => [s.source, s._count.id])),
          topKeywords,
          topCategories: categoryGroups.map((c) => ({
            categoryName: c.categoryName,
            synonymCount: c._count.id,
          })),
          recentSynonyms,
          recentlyCreatedCount: recentlyCreated,
          learningOpportunities,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      this.logger.error('❌ Erro ao buscar estatísticas de sinônimos:', error);

      return {
        success: false,
        message: 'Erro ao buscar estatísticas de sinônimos',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  // ========================================
  // 👤 USUÁRIO - RESUMO COMPLETO
  // ========================================

  /**
   * Resumo completo do usuário para dashboard
   * GET /admin/users/:userId/summary
   * 
   * Retorna dados do usuário + últimos 50 registros de:
   * - RAG logs
   - AI usage logs
   * - Sinônimos
   * - Transações (confirmações)
   * - Mensagens não reconhecidas
   * - Sessões de onboarding
   */
  @Get('users/:userId/summary')
  async getUserSummary(@Param('userId') userId: string) {
    this.logger.log(`📊 Admin solicitou resumo completo do usuário: ${userId}`);

    try {
      // 1. Buscar dados do usuário
      const user = await this.prisma.userCache.findUnique({
        where: { gastoCertoId: userId },
      });

      if (!user) {
        return {
          success: false,
          message: 'Usuário não encontrado',
          timestamp: new Date().toISOString(),
        };
      }

      // 🔄 Sincronizar status de assinatura se necessário (1h)
      if (this.cacheService.needsSync(user)) {
        this.logger.log(`⏰ [Admin] Syncing subscription status for ${userId}`);
        await this.cacheService.syncSubscriptionStatus(userId);

        // Recarregar usuário com dados atualizados
        const updatedUser = await this.prisma.userCache.findUnique({
          where: { gastoCertoId: userId },
        });
        if (updatedUser) {
          Object.assign(user, updatedUser);
        }
      }

      // 2. RAG Search Logs (últimos 50)
      const ragLogs = await this.prisma.rAGSearchLog.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          query: true,
          queryNormalized: true,
          bestMatch: true,
          bestScore: true,
          success: true,
          ragMode: true,
          responseTime: true,
          wasAiFallback: true,
          flowStep: true,
          totalSteps: true,
          aiProvider: true,
          aiModel: true,
          finalCategoryName: true,
          createdAt: true,
        },
      });

      // 3. AI Usage Logs (últimos 50)
      const aiLogs = await this.prisma.aIUsageLog.findMany({
        where: { userCacheId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          provider: true,
          model: true,
          operation: true,
          inputType: true,
          totalTokens: true,
          estimatedCost: true,
          responseTime: true,
          success: true,
          aiCategoryName: true,
          finalCategoryName: true,
          aiConfidence: true,
          wasRagFallback: true,
          needsSynonymLearning: true,
          createdAt: true,
        },
      });

      // 4. Sinônimos do usuário (todos, limitado a 50)
      const synonyms = await this.prisma.userSynonym.findMany({
        where: { userId },
        orderBy: { usageCount: 'desc' },
        take: 50,
        select: {
          id: true,
          keyword: true,
          categoryName: true,
          subCategoryName: true,
          confidence: true,
          source: true,
          usageCount: true,
          lastUsedAt: true,
          createdAt: true,
        },
      });

      // 5. Transações do usuário (últimas 10, ordenadas por data mais recente)
      const transactionConfirmations = await this.prisma.transactionConfirmation.findMany({
        where: { userId: user.id },
        orderBy: { date: 'desc' },
        take: 10,
        select: {
          id: true,
          description: true,
          amount: true,
          category: true,
          categoryId: true,
          subCategoryId: true,
          subCategoryName: true,
          type: true,
          date: true,
          status: true,
          apiSent: true,
          apiSentAt: true,
          createdAt: true,
          confirmedAt: true,
        },
      });

      // 6. Mensagens não reconhecidas (últimas 50)
      const unrecognizedMessages = await this.prisma.unrecognizedMessage.findMany({
        where: { userCacheId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          messageText: true,
          detectedIntent: true,
          confidence: true,
          wasProcessed: true,
          addedToContext: true,
          createdAt: true,
        },
      });

      // 7. Sessões de onboarding (últimas 10)
      const onboardingSessions = await this.prisma.onboardingSession.findMany({
        where: { phoneNumber: user.phoneNumber },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          platformId: true,
          currentStep: true,
          completed: true,
          attempts: true,
          lastMessageAt: true,
          expiresAt: true,
          createdAt: true,
        },
      });

      // 8. Buscar categorias do usuário (via API GastoCerto)
      let accounts: any[] = [];

      try {
        // Buscar contas do usuário
        accounts = await this.cacheService['gastoCertoApi'].getUserAccounts(userId);
      } catch (error) {
        this.logger.warn(`⚠️ Erro ao buscar categorias/contas da API: ${error.message}`);
      }

      // 9. Calcular estatísticas
      const stats = {
        rag: {
          total: ragLogs.length,
          successful: ragLogs.filter((l) => l.success).length,
          successRate:
            ragLogs.length > 0
              ? ((ragLogs.filter((l) => l.success).length / ragLogs.length) * 100).toFixed(2) + '%'
              : '0%',
          aiFallbackCount: ragLogs.filter((l) => l.wasAiFallback).length,
          avgResponseTime:
            ragLogs.length > 0
              ? Math.round(
                  ragLogs.reduce((sum, l) => sum + (l.responseTime || 0), 0) / ragLogs.length,
                ) + 'ms'
              : '0ms',
        },
        ai: {
          total: aiLogs.length,
          successful: aiLogs.filter((l) => l.success).length,
          totalTokens: aiLogs.reduce((sum, l) => sum + l.totalTokens, 0),
          totalCost: aiLogs.reduce((sum, l) => sum + Number(l.estimatedCost), 0).toFixed(6),
          needsSynonymLearning: aiLogs.filter((l) => l.needsSynonymLearning).length,
          avgResponseTime:
            aiLogs.length > 0
              ? Math.round(
                  aiLogs.reduce((sum, l) => sum + (l.responseTime || 0), 0) / aiLogs.length,
                ) + 'ms'
              : '0ms',
        },
        synonyms: {
          total: synonyms.length,
          totalUsage: synonyms.reduce((sum, s) => sum + s.usageCount, 0),
          bySource: synonyms.reduce(
            (acc, s) => {
              acc[s.source] = (acc[s.source] || 0) + 1;
              return acc;
            },
            {} as Record<string, number>,
          ),
        },
        transactions: {
          total: transactionConfirmations.length,
          confirmed: transactionConfirmations.filter((t) => t.status === 'CONFIRMED').length,
          pending: transactionConfirmations.filter((t) => t.status === 'PENDING').length,
          sent: transactionConfirmations.filter((t) => t.apiSent).length,
          totalAmount: transactionConfirmations
            .reduce((sum, t) => sum + Number(t.amount), 0)
            .toFixed(2),
        },
        unrecognized: {
          total: unrecognizedMessages.length,
          notProcessed: unrecognizedMessages.filter((m) => !m.wasProcessed).length,
        },
        onboarding: {
          total: onboardingSessions.length,
          completed: onboardingSessions.filter((s) => s.completed).length,
          inProgress: onboardingSessions.filter((s) => !s.completed).length,
        },
      };

      return {
        success: true,
        user: {
          id: user.id,
          gastoCertoId: user.gastoCertoId,
          phoneNumber: user.phoneNumber,
          whatsappId: user.whatsappId,
          telegramId: user.telegramId,
          email: user.email,
          name: user.name,
          hasActiveSubscription: user.hasActiveSubscription,
          isBlocked: user.isBlocked,
          isActive: user.isActive,
          activeAccountId: user.activeAccountId,
          accounts: user.accounts,
          lastSyncAt: user.lastSyncAt,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
        stats,
        data: {
          ragLogs: ragLogs.map((log) => ({
            ...log,
            bestScore: log.bestScore ? Number(log.bestScore) : null,
          })),
          aiLogs: aiLogs.map((log) => ({
            ...log,
            estimatedCost: Number(log.estimatedCost),
            aiConfidence: log.aiConfidence ? Number(log.aiConfidence) : null,
          })),
          synonyms,
          transactions: transactionConfirmations.map((t) => ({
            ...t,
            amount: Number(t.amount),
          })),
          unrecognizedMessages,
          onboardingSessions,
          accounts: accounts.map((acc) => ({
            id: acc.id,
            name: acc.name,
            role: acc.role,
            isPrimary: acc.isPrimary,
            isCreator: acc.isCreator,
          })),
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      this.logger.error('❌ Erro ao buscar resumo do usuário:', error);

      return {
        success: false,
        message: 'Erro ao buscar resumo do usuário',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * POST /admin/users/:userId/sync-categories
   * Força a sincronização das categorias do usuário com a API do GastoCerto
   */
  @Post('users/:userId/sync-categories')
  async syncUserCategories(@Param('userId') userId: string) {
    try {
      this.logger.log(`🔄 Forçando sync de categorias para usuário: ${userId}`);

      // 1. Buscar usuário
      const user = await this.prisma.userCache.findUnique({
        where: { gastoCertoId: userId },
      });

      if (!user) {
        throw new NotFoundException('Usuário não encontrado');
      }

      // 2. Buscar contas atualizadas da API
      const accounts = await this.cacheService['gastoCertoApi'].getUserAccounts(userId);

      // 3. Buscar categorias da conta ativa
      let categories: any[] = [];
      if (user.activeAccountId) {
        categories = await this.cacheService['gastoCertoApi'].getAccountCategories(
          userId,
          user.activeAccountId,
        );
      }

      // 4. Atualizar cache do usuário
      await this.prisma.userCache.update({
        where: { gastoCertoId: userId },
        data: {
          accounts: accounts as any,
          lastSyncAt: new Date(),
        },
      });

      // 5. Limpar cache RAG para forçar reindexação
      const cacheKey = `rag:embeddings:${userId}`;
      const redisClient = this.redisService.getClient();
      await redisClient.del(cacheKey);

      this.logger.log(`✅ Categorias sincronizadas com sucesso: ${categories.length} categorias`);

      return {
        success: true,
        message: 'Categorias sincronizadas com sucesso',
        data: {
          totalAccounts: accounts.length,
          activeAccountId: user.activeAccountId,
          totalCategories: categories.length,
          categories: categories.map((cat) => ({
            id: cat.id || cat.categoryId,
            name: cat.name || cat.categoryName,
            type: cat.type,
            accountId: cat.accountId,
            subCategoriesCount: cat.subCategories?.length || 0,
          })),
          lastSyncAt: new Date().toISOString(),
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      this.logger.error('❌ Erro ao sincronizar categorias:', error);

      return {
        success: false,
        message: 'Erro ao sincronizar categorias',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * GET /admin/users/:userId/accounts/:accountId/categories
   * Retorna as categorias de uma conta específica
   */
  @Get('users/:userId/accounts/:accountId/categories')
  async getAccountCategories(
    @Param('userId') userId: string,
    @Param('accountId') accountId: string,
  ) {
    try {
      this.logger.log(`📂 Buscando categorias da conta ${accountId} para usuário: ${userId}`);

      // 1. Verificar se usuário existe
      const user = await this.prisma.userCache.findUnique({
        where: { gastoCertoId: userId },
      });

      if (!user) {
        throw new NotFoundException('Usuário não encontrado');
      }

      // 2. Buscar categorias da conta específica
      const categories = await this.cacheService['gastoCertoApi'].getAccountCategories(
        userId,
        accountId,
      );

      this.logger.log(`✅ ${categories.length} categorias encontradas para conta ${accountId}`);

      return {
        success: true,
        data: {
          userId,
          accountId,
          totalCategories: categories.length,
          categories: categories.map((cat) => ({
            id: cat.id,
            name: cat.name,
            type: cat.type,
            icon: cat.icon,
            color: cat.color,
            subCategories: cat.subCategories || [],
          })),
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      this.logger.error('❌ Erro ao buscar categorias da conta:', error);

      return {
        success: false,
        message: 'Erro ao buscar categorias da conta',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}
