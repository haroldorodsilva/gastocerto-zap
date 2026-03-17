import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
  NotFoundException,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { PrismaService } from '@core/database/prisma.service';
import { TransactionConfirmationService } from './transaction-confirmation.service';
import { TransactionRegistrationService } from './contexts/registration/registration.service';
import { ConfirmationStatus } from '@prisma/client';

@Controller('admin/transactions')
@UseGuards(JwtAuthGuard)
export class TransactionsController {
  private readonly logger = new Logger(TransactionsController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly confirmationService: TransactionConfirmationService,
    private readonly registrationService: TransactionRegistrationService,
  ) {}

  /**
   * Lista todas as transações com filtros opcionais
   * GET /admin/transactions?userId=xxx&accountId=xxx&dateFrom=2025-01-01&dateTo=2025-12-31&status=CONFIRMED&type=EXPENSES&apiSent=true
   */
  @Get()
  async listTransactions(
    @Query('userId') userId?: string,
    @Query('accountId') accountId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('apiSent') apiSent?: string,
    @Query('phoneNumber') phoneNumber?: string,
    @Query('limit') limit?: string,
    @Query('page') page?: string,
  ) {
    this.logger.log('📋 Listando todas as transações com filtros');

    try {
      const pageNum = parseInt(page || '1');
      const limitNum = parseInt(limit || '50');
      const skip = (pageNum - 1) * limitNum;

      // Construir filtros dinamicamente
      const where: any = {};

      // Filtrar por status
      if (status) {
        where.status = status.toUpperCase();
      }

      // Filtrar por tipo de transação (EXPENSES | INCOME)
      if (type) {
        where.type = type.toUpperCase();
      }

      // Filtrar por envio à API
      if (apiSent !== undefined) {
        where.apiSent = apiSent === 'true';
      }

      // Filtrar por userId (gastoCertoId do usuário)
      if (userId) {
        where.user = {
          gastoCertoId: userId,
        };
      }

      // Filtrar por número de telefone
      if (phoneNumber) {
        where.phoneNumber = phoneNumber;
      }

      // Filtrar por accountId
      if (accountId) {
        where.accountId = accountId;
      }

      // Filtrar por data da transação
      if (dateFrom || dateTo) {
        where.date = {};
        if (dateFrom) {
          where.date.gte = new Date(dateFrom);
        }
        if (dateTo) {
          where.date.lte = new Date(dateTo);
        }
      }

      // Buscar transações com TODOS os campos de auditoria
      const [transactions, total] = await Promise.all([
        this.prisma.transactionConfirmation.findMany({
          where,
          select: {
            id: true,
            phoneNumber: true,
            platform: true,
            userId: true,
            accountId: true,
            messageId: true,
            type: true,
            amount: true,
            category: true,
            categoryId: true,
            subCategoryId: true,
            subCategoryName: true,
            description: true,
            date: true,
            extractedData: true,
            status: true,
            confirmedAt: true,
            apiSent: true,
            apiSentAt: true,
            apiError: true,
            apiRetryCount: true,
            creditCardId: true,
            installments: true,
            installmentNumber: true,
            invoiceMonth: true,
            isFixed: true,
            fixedFrequency: true,
            paymentStatus: true,
            aiUsageLogId: true,
            ragSearchLogId: true,
            createdAt: true,
            expiresAt: true,
            deletedAt: true,
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
        data: transactions.map((t) => ({
          ...t,
          amountFormatted: `R$ ${(Number(t.amount) / 100).toFixed(2)}`,
          isDeleted: !!t.deletedAt,
        })),
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
        filters: {
          userId,
          accountId,
          phoneNumber,
          dateFrom,
          dateTo,
          status,
          type,
          apiSent,
        },
        timestamp: new Date().toISOString(),
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
   * Lista apenas transações pendentes (atalho para backward compatibility)
   * GET /admin/transactions/pending
   */
  @Get('pending')
  async listPendingTransactions(
    @Query('userId') userId?: string,
    @Query('accountId') accountId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('limit') limit?: string,
    @Query('page') page?: string,
  ) {
    return this.listTransactions(
      userId,
      accountId,
      dateFrom,
      dateTo,
      'PENDING',
      undefined,
      undefined,
      undefined,
      limit,
      page,
    );
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

  /**
   * Detalhe completo de uma transação individual para auditoria
   * GET /admin/transactions/:id
   * IMPORTANTE: deve ficar APÓS todas as rotas estáticas (pending, stats)
   */
  @Get(':id')
  async getTransactionDetail(@Param('id') id: string) {
    this.logger.log(`🔍 Buscando detalhe da transação: ${id}`);

    const transaction = await this.prisma.transactionConfirmation.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            gastoCertoId: true,
            phoneNumber: true,
            email: true,
            activeAccountId: true,
          },
        },
      },
    });

    if (!transaction) {
      throw new NotFoundException(`Transação ${id} não encontrada`);
    }

    // Buscar AI usage log relacionado (se existir)
    let aiUsageLog = null;
    if (transaction.aiUsageLogId) {
      aiUsageLog = await this.prisma.aIUsageLog.findUnique({
        where: { id: transaction.aiUsageLogId },
      });
    }

    // Buscar RAG search log relacionado (se existir)
    let ragSearchLog = null;
    if (transaction.ragSearchLogId) {
      ragSearchLog = await this.prisma.rAGSearchLog.findUnique({
        where: { id: transaction.ragSearchLogId },
      });
    }

    return {
      success: true,
      data: {
        ...transaction,
        amountFormatted: `R$ ${(Number(transaction.amount) / 100).toFixed(2)}`,
        isDeleted: !!transaction.deletedAt,
        relatedLogs: {
          aiUsageLog,
          ragSearchLog,
        },
      },
    };
  }
}
