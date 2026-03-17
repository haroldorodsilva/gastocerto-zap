import {
  Controller,
  Post,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
  Delete,
  Get,
} from '@nestjs/common';
import { UserCacheService } from '../users/user-cache.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { PrismaService } from '@core/database/prisma.service';
import { SessionsService } from '@infrastructure/messaging/core/services/sessions.service';
import { SessionManagerService } from '@infrastructure/core/session-manager.service';
import { TelegramSessionsService } from '@infrastructure/telegram/providers/telegram-sessions.service';

/**
 * AdminController (Core)
 *
 * Endpoints centrais: cache e health check.
 * Endpoints especializados extraídos para controllers dedicados:
 * - AdminUsersController: gestão de usuários
 * - AdminAIConfigController: configuração de IA
 * - AdminRagController: logs, stats, testing e sinônimos RAG
 * - AdminSynonymsController: gerenciamento de sinônimos
 * - AdminOnboardingController: sessões de onboarding
 * - AdminMessagesController: mensagens não reconhecidas e confirmações
 */
@Controller('admin')
@UseGuards(JwtAuthGuard)
export class AdminController {
  private readonly logger = new Logger(AdminController.name);

  constructor(
    private readonly cacheService: UserCacheService,
    private readonly prisma: PrismaService,
    private readonly sessionsService: SessionsService,
    private readonly sessionManager: SessionManagerService,
    private readonly telegramSessionsService: TelegramSessionsService,
  ) {}

  /**
   * Limpa todo o cache Redis
   * POST /admin/cache/clear
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
   * Health check com status de todos os serviços
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
      this.prisma.userCache.count(),
      this.cacheService.countActiveUsers(),
      this.prisma.onboardingSession.count({
        where: { completed: true },
      }),
      this.prisma.onboardingSession.count({
        where: {
          completed: false,
          expiresAt: { gt: new Date() },
        },
      }),
      this.prisma.aIProviderConfig.count({
        where: { enabled: true },
      }),
    ]);

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
}
