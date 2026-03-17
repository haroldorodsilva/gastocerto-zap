import {
  Controller,
  UseGuards,
  Logger,
  Get,
  Delete,
  Param,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import { PrismaService } from '@core/database/prisma.service';

@Controller('admin')
@UseGuards(JwtAuthGuard)
export class AdminMessagesController {
  private readonly logger = new Logger(AdminMessagesController.name);

  constructor(private readonly prisma: PrismaService) {}

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

      const where: any = { deletedAt: null };

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
}
