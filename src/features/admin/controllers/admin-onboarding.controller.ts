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
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { PrismaService } from '@core/database/prisma.service';
import { GastoCertoApiService } from '@shared/gasto-certo-api.service';
import { UserCacheService } from '@features/users/user-cache.service';

@Controller('admin')
@UseGuards(JwtAuthGuard)
export class AdminOnboardingController {
  private readonly logger = new Logger(AdminOnboardingController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gastoCertoApi: GastoCertoApiService,
    private readonly userCacheService: UserCacheService,
  ) {}

  @Post('onboarding/manual')
  @HttpCode(HttpStatus.CREATED)
  async manualOnboarding(
    @Body() dto: { phoneNumber: string; name: string; email: string; notes?: string },
  ) {
    this.logger.log(`Onboarding manual: ${dto.phoneNumber} (${dto.name})`);

    if (!dto.phoneNumber || !dto.name || !dto.email) {
      throw new BadRequestException('phoneNumber, name e email são obrigatórios');
    }

    // Verificar se usuário já existe no cache
    const existing = await this.userCacheService.getUser(dto.phoneNumber);
    if (existing) {
      throw new ConflictException(`Usuário ${dto.phoneNumber} já existe (gastoCertoId: ${existing.gastoCertoId})`);
    }

    // Criar usuário na API GastoCerto
    let createdUser: any;
    try {
      createdUser = await this.gastoCertoApi.createUser({
        name: dto.name,
        email: dto.email,
        phoneNumber: dto.phoneNumber,
        source: 'admin_manual',
        acceptedTerms: true,
        metadata: {
          notes: dto.notes || '',
          createdBy: 'admin_panel',
        },
      });
    } catch (apiError) {
      this.logger.error(`Erro ao criar usuário na API GastoCerto: ${apiError.message}`);
      throw new InternalServerErrorException(`Falha ao criar usuário na API: ${apiError.message}`);
    }

    this.logger.log(`✅ Usuário criado na API GastoCerto: ${createdUser?.id || 'N/A'}`);

    return {
      success: true,
      message: `Usuário ${dto.phoneNumber} criado com sucesso`,
      userId: createdUser?.id,
      email: dto.email,
    };
  }

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
}
