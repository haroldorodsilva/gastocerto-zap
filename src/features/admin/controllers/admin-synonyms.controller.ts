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
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { PrismaService } from '@core/database/prisma.service';
import { RAGService } from '@infrastructure/rag/services/rag.service';
import { UserSynonymService } from '@infrastructure/rag/services/user-synonym.service';

@Controller('admin')
@UseGuards(JwtAuthGuard)
export class AdminSynonymsController {
  private readonly logger = new Logger(AdminSynonymsController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ragService: RAGService,
    private readonly userSynonymService: UserSynonymService,
  ) {}

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

      await this.userSynonymService.addUserSynonym({
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
          await this.userSynonymService.addUserSynonym({
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
}
