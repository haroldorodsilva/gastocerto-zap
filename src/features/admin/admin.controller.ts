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
} from '@nestjs/common';
import { UserCacheService } from '../users/user-cache.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { PrismaService } from '@core/database/prisma.service';
import { AIConfigService } from '../../infrastructure/ai/ai-config.service';
import { SessionsService } from '../../infrastructure/whatsapp/sessions/sessions.service';
import { SessionManagerService } from '../../infrastructure/whatsapp/sessions/session-manager.service';
import { TelegramSessionsService } from '../../infrastructure/whatsapp/sessions/telegram/telegram-sessions.service';
import { RAGService } from '../../infrastructure/ai/rag/rag.service';

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
          const ttl = await this.cacheService['redis'].ttl(redisKey);
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
   * Bloqueia usuário (desativa bot para esse número)
   * POST /admin/users/block
   */
  @Post('users/block')
  @HttpCode(HttpStatus.OK)
  async blockUser(@Body() dto: { phoneNumber: string; reason?: string }) {
    this.logger.warn(`Bloqueando usuário: ${dto.phoneNumber} (motivo: ${dto.reason || 'N/A'})`);

    const session = await this.prisma.whatsAppSession.findFirst({
      where: { phoneNumber: dto.phoneNumber },
      orderBy: { updatedAt: 'desc' },
    });

    if (!session) {
      throw new BadRequestException(`Sessão não encontrada para: ${dto.phoneNumber}`);
    }

    await this.prisma.whatsAppSession.update({
      where: { id: session.id },
      data: {
        isActive: false,
        status: 'DISCONNECTED',
        updatedAt: new Date(),
      },
    });

    await this.sessionManager.stopSession(session.sessionId);

    return {
      success: true,
      message: `Usuário ${dto.phoneNumber} bloqueado com sucesso`,
    };
  }

  /**
   * Ativa/desbloqueia usuário
   * POST /admin/users/activate
   */
  @Post('users/activate')
  @HttpCode(HttpStatus.OK)
  async activateUser(@Body() dto: { phoneNumber: string }) {
    this.logger.log(`Ativando usuário: ${dto.phoneNumber}`);

    const session = await this.prisma.whatsAppSession.findFirst({
      where: { phoneNumber: dto.phoneNumber },
      orderBy: { updatedAt: 'desc' },
    });

    if (!session) {
      throw new BadRequestException(`Sessão não encontrada para: ${dto.phoneNumber}`);
    }

    await this.prisma.whatsAppSession.update({
      where: { id: session.id },
      data: {
        isActive: true,
        status: 'DISCONNECTED',
        updatedAt: new Date(),
      },
    });

    await this.sessionManager.startSession(session.sessionId);

    return {
      success: true,
      message: `Usuário ${dto.phoneNumber} ativado com sucesso`,
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
    const [totalSessions, activeSessions, connectedSessions, telegramSessions] = await Promise.all([
      this.sessionsService.countSessions(),
      this.sessionsService.getActiveSessions(),
      this.sessionsService.getConnectedSessions(),
      this.telegramSessionsService.findAll(),
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
        active: activeProviders,
      },
      service: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
      },
    };
  }

  /**
   * Consultar logs de busca RAG (analytics)
   * GET /admin/rag-search-logs?userId=xxx&failedOnly=true&limit=100
   */
  @Get('rag-search-logs')
  async getRagSearchLogs(
    @Query('userId') userId?: string,
    @Query('failedOnly') failedOnly?: string,
    @Query('limit') limit?: string,
  ) {
    this.logger.log('📊 Admin solicitou logs de busca RAG');

    try {
      const failedFilter = failedOnly === 'true';
      const limitNum = parseInt(limit || '100');

      // Buscar logs via RAGService
      const logs = await this.ragService.getSearchAttempts(userId || null, failedFilter);

      // Calcular estatísticas
      const totalAttempts = logs.length;
      const successfulAttempts = logs.filter((log) => log.success).length;
      const failedAttempts = totalAttempts - successfulAttempts;
      const successRate =
        totalAttempts > 0 ? ((successfulAttempts / totalAttempts) * 100).toFixed(2) : '0.00';

      // Top queries que falharam
      const failedQueries = logs
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

      return {
        success: true,
        data: logs.slice(0, limitNum),
        stats: {
          totalAttempts,
          successfulAttempts,
          failedAttempts,
          successRate: `${successRate}%`,
          topFailedQueries,
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
}
