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
  Body,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { UserCacheService } from '../../users/user-cache.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { PrismaService } from '@core/database/prisma.service';
import { SessionManagerService } from '@infrastructure/core/session-manager.service';
import { RedisService } from '@common/services/redis.service';

@Controller('admin')
@UseGuards(JwtAuthGuard)
export class AdminUsersController {
  private readonly logger = new Logger(AdminUsersController.name);

  constructor(
    private readonly cacheService: UserCacheService,
    private readonly prisma: PrismaService,
    private readonly sessionManager: SessionManagerService,
    private readonly redisService: RedisService,
  ) {}

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
        where: { userId: user.id, deletedAt: null },
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
          canUseGastoZap: user.canUseGastoZap,
          isBlocked: user.isBlocked,
          isActive: user.isActive,
          activeAccountId: user.activeAccountId,
          accounts: user.accounts,
          lastSyncAt: user.lastSyncAt,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
          subscriptionInfo: {
            canUseService: user.canUseGastoZap,
            hasActiveSubscription: user.hasActiveSubscription,
            isBlocked: user.isBlocked,
            isActive: user.isActive,
            lastSync: user.updatedAt,
            needsSync: this.cacheService.needsSync(user),
          },
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
   * POST /admin/users/:userId/sync-cache
   * Limpa cache do usuário e busca dados atualizados da API
   * Útil para forçar refresh de dados de assinatura, contas, etc.
   */
  @Post('users/:userId/sync-cache')
  async syncUserCache(@Param('userId') userId: string) {
    this.logger.log(`🔄 Admin solicitou sync completo do cache: ${userId}`);

    try {
      // 1. Buscar usuário
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

      // 2. Limpar cache Redis
      const redisClient = this.redisService.getClient();
      const cacheKeys = [
        `user:${userId}`,
        `user:${user.phoneNumber}`,
        user.whatsappId ? `user:${user.whatsappId}` : null,
        user.telegramId ? `user:${user.telegramId}` : null,
      ].filter(Boolean);

      for (const key of cacheKeys) {
        await redisClient.del(key);
      }

      this.logger.log(`🗑️ Cache Redis limpo: ${cacheKeys.length} chaves`);

      // 3. Buscar dados atualizados da API
      const apiUser = await this.cacheService['gastoCertoApi'].getUserById(userId);

      // 4. Sincronizar status de assinatura
      const subscriptionStatus =
        await this.cacheService['gastoCertoApi'].getSubscriptionStatus(userId);

      // 5. Atualizar banco de dados
      const updatedUser = await this.prisma.userCache.update({
        where: { gastoCertoId: userId },
        data: {
          name: apiUser.name,
          email: apiUser.email,
          phoneNumber: apiUser.phoneNumber || user.phoneNumber,
          hasActiveSubscription: subscriptionStatus.isActive,
          canUseGastoZap: subscriptionStatus.canUseGastoZap,
          isActive: apiUser.isActive ?? true,
          isBlocked: apiUser.isBlocked ?? false,
          accounts: apiUser.accounts as any,
          categories: apiUser.categories as any,
          preferences: apiUser.preferences as any,
          lastSyncAt: new Date(),
          updatedAt: new Date(),
        },
      });

      this.logger.log(`✅ Cache sincronizado com sucesso: ${userId}`);

      return {
        success: true,
        message: 'Cache sincronizado com sucesso',
        data: {
          userId: updatedUser.gastoCertoId,
          name: updatedUser.name,
          email: updatedUser.email,
          hasActiveSubscription: updatedUser.hasActiveSubscription,
          canUseGastoZap: updatedUser.canUseGastoZap,
          isActive: updatedUser.isActive,
          isBlocked: updatedUser.isBlocked,
          lastSyncAt: updatedUser.lastSyncAt,
          updatedAt: updatedUser.updatedAt,
          cacheKeysCleared: cacheKeys.length,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      this.logger.error(`❌ Erro ao sincronizar cache: ${error.message}`, error.stack);

      return {
        success: false,
        message: 'Erro ao sincronizar cache',
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
