import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '@core/database/prisma.service';
import { TransactionConfirmationService } from './transaction-confirmation.service';
import { TransactionRegistrationService } from './contexts/registration/registration.service';
import { ConfirmationStatus } from '@prisma/client';

@Controller('admin/transactions')
export class TransactionsController {
  private readonly logger = new Logger(TransactionsController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly confirmationService: TransactionConfirmationService,
    private readonly registrationService: TransactionRegistrationService,
  ) {}

  /**
   * Lista transações pendentes com filtros opcionais
   * GET /admin/transactions/pending?userId=xxx&accountId=xxx&dateFrom=2025-01-01&dateTo=2025-12-31
   */
  @Get('pending')
  async listPendingTransactions(
    @Query('userId') userId?: string,
    @Query('accountId') accountId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('page') page?: string,
  ) {
    this.logger.log('📋 Listando transações pendentes com filtros');

    try {
      const pageNum = parseInt(page || '1');
      const limitNum = parseInt(limit || '50');
      const skip = (pageNum - 1) * limitNum;

      // Construir filtros dinamicamente
      const where: any = {};

      // Status (padrão: apenas pendentes e com erro)
      if (status) {
        where.status = status.toUpperCase();
      } else {
        where.OR = [
          { status: ConfirmationStatus.PENDING },
          { status: ConfirmationStatus.CONFIRMED, apiSent: false },
        ];
      }

      // Filtrar por userId (gastoCertoId do usuário)
      if (userId) {
        where.user = {
          gastoCertoId: userId,
        };
      }

      // Filtrar por accountId
      if (accountId) {
        where.accountId = accountId;
      }

      // Filtrar por data
      if (dateFrom || dateTo) {
        where.date = {};
        if (dateFrom) {
          where.date.gte = new Date(dateFrom);
        }
        if (dateTo) {
          where.date.lte = new Date(dateTo);
        }
      }

      // Buscar transações
      const [transactions, total] = await Promise.all([
        this.prisma.transactionConfirmation.findMany({
          where,
          include: {
            user: {
              select: {
                id: true,
                name: true,
                gastoCertoId: true,
                phoneNumber: true,
                activeAccountId: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: limitNum,
        }),
        this.prisma.transactionConfirmation.count({ where }),
      ]);

      this.logger.log(`✅ Encontradas ${transactions.length} transações (total: ${total})`);

      return {
        success: true,
        data: transactions,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
        filters: {
          userId,
          accountId,
          dateFrom,
          dateTo,
          status: status || 'PENDING or (CONFIRMED and not sent)',
        },
      };
    } catch (error: any) {
      this.logger.error('❌ Erro ao listar transações:', error);
      throw new BadRequestException({
        success: false,
        message: 'Erro ao listar transações',
        error: error.message,
      });
    }
  }

  /**
   * Reenvia transações pendentes para a API
   * POST /admin/transactions/resend
   * Body: { transactionIds: ['id1', 'id2'] } ou filtros
   */
  @Post('resend')
  @HttpCode(HttpStatus.OK)
  async resendTransactions(
    @Body()
    body: {
      transactionIds?: string[];
      userId?: string;
      accountId?: string;
      dateFrom?: string;
      dateTo?: string;
    },
  ) {
    this.logger.log('🔄 Solicitação de reenvio de transações');

    try {
      let transactionsToResend: any[] = [];

      // Opção 1: IDs específicos
      if (body.transactionIds && body.transactionIds.length > 0) {
        transactionsToResend = await this.prisma.transactionConfirmation.findMany({
          where: {
            id: { in: body.transactionIds },
            status: ConfirmationStatus.CONFIRMED,
            apiSent: false,
          },
        });
      }
      // Opção 2: Filtros
      else {
        const where: any = {
          status: ConfirmationStatus.CONFIRMED,
          apiSent: false,
        };

        if (body.userId) {
          where.user = { gastoCertoId: body.userId };
        }

        if (body.accountId) {
          where.accountId = body.accountId;
        }

        if (body.dateFrom || body.dateTo) {
          where.date = {};
          if (body.dateFrom) where.date.gte = new Date(body.dateFrom);
          if (body.dateTo) where.date.lte = new Date(body.dateTo);
        }

        transactionsToResend = await this.prisma.transactionConfirmation.findMany({
          where,
          take: 100, // Limite de segurança
        });
      }

      if (transactionsToResend.length === 0) {
        return {
          success: true,
          message: 'Nenhuma transação encontrada para reenviar',
          processed: 0,
          succeeded: 0,
          failed: 0,
        };
      }

      this.logger.log(`🔄 Reenviando ${transactionsToResend.length} transações`);

      const results = {
        processed: transactionsToResend.length,
        succeeded: 0,
        failed: 0,
        errors: [] as any[],
      };

      // Reenviar cada transação
      for (const transaction of transactionsToResend) {
        try {
          // Chamar o serviço de registro para reenviar usando os dados salvos
          const result = await this.registrationService.resendTransaction(transaction.id);

          if (result.success) {
            results.succeeded++;
            this.logger.log(`✅ Transação ${transaction.id} reenviada com sucesso`);
          } else {
            results.failed++;
            results.errors.push({
              transactionId: transaction.id,
              error: result.error || 'Erro desconhecido',
            });
            this.logger.error(`❌ Erro ao reenviar ${transaction.id}: ${result.error}`);
          }
        } catch (error: any) {
          results.failed++;
          results.errors.push({
            transactionId: transaction.id,
            error: error.message,
          });
          this.logger.error(`❌ Erro ao processar ${transaction.id}:`, error);
        }
      }

      return {
        success: true,
        message: `Processadas ${results.processed} transações`,
        ...results,
      };
    } catch (error: any) {
      this.logger.error('❌ Erro ao reenviar transações:', error);
      throw new BadRequestException({
        success: false,
        message: 'Erro ao reenviar transações',
        error: error.message,
      });
    }
  }

  /**
   * Obtém estatísticas das transações
   * GET /admin/transactions/stats
   */
  @Get('stats')
  async getTransactionStats(@Query('userId') userId?: string) {
    this.logger.log('📊 Buscando estatísticas de transações');

    try {
      const where: any = userId ? { user: { gastoCertoId: userId } } : {};

      const [
        total,
        pending,
        confirmed,
        expired,
        rejected,
        sent,
        failed,
        withCategoryId,
        withSubCategoryId,
      ] = await Promise.all([
        this.prisma.transactionConfirmation.count({ where }),
        this.prisma.transactionConfirmation.count({
          where: { ...where, status: ConfirmationStatus.PENDING },
        }),
        this.prisma.transactionConfirmation.count({
          where: { ...where, status: ConfirmationStatus.CONFIRMED },
        }),
        this.prisma.transactionConfirmation.count({
          where: { ...where, status: ConfirmationStatus.EXPIRED },
        }),
        this.prisma.transactionConfirmation.count({
          where: { ...where, status: ConfirmationStatus.REJECTED },
        }),
        this.prisma.transactionConfirmation.count({
          where: { ...where, apiSent: true },
        }),
        this.prisma.transactionConfirmation.count({
          where: { ...where, apiSent: false, status: ConfirmationStatus.CONFIRMED },
        }),
        this.prisma.transactionConfirmation.count({
          where: { ...where, categoryId: { not: null } },
        }),
        this.prisma.transactionConfirmation.count({
          where: { ...where, subCategoryId: { not: null } },
        }),
      ]);

      return {
        success: true,
        stats: {
          total,
          byStatus: {
            pending,
            confirmed,
            expired,
            rejected,
          },
          api: {
            sent,
            failed,
            successRate: total > 0 ? ((sent / total) * 100).toFixed(2) + '%' : '0%',
          },
          categories: {
            withCategoryId,
            withSubCategoryId,
            categoryResolutionRate:
              total > 0 ? ((withCategoryId / total) * 100).toFixed(2) + '%' : '0%',
            subCategoryResolutionRate:
              total > 0 ? ((withSubCategoryId / total) * 100).toFixed(2) + '%' : '0%',
          },
        },
        filters: {
          userId: userId || 'all',
        },
      };
    } catch (error: any) {
      this.logger.error('❌ Erro ao buscar estatísticas:', error);
      throw new BadRequestException({
        success: false,
        message: 'Erro ao buscar estatísticas',
        error: error.message,
      });
    }
  }
}
