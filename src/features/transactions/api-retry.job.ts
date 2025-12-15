import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@core/database/prisma.service';
import { ConfirmationStatus } from '@prisma/client';
import { TransactionRegistrationService } from './contexts/registration/registration.service';
import { DiscordNotificationService } from '@common/services/discord-notification.service';

@Injectable()
export class ApiRetryJob {
  private readonly logger = new Logger(ApiRetryJob.name);
  private readonly MAX_RETRY_ATTEMPTS = 5;
  private isRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registrationService: TransactionRegistrationService,
    private readonly discordNotification: DiscordNotificationService,
  ) {}

  /**
   * Job que roda a cada 5 minutos para retentar enviar transações confirmadas para API
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async retryFailedApiSends() {
    if (this.isRunning) {
      this.logger.debug('⏭️  Job já está rodando, pulando execução');
      return;
    }

    this.isRunning = true;

    try {
      this.logger.log(`\n🔄 ========== RETRY API JOB ==========`);

      // Buscar confirmações CONFIRMED que ainda não foram enviadas para API
      const pendingConfirmations = await this.prisma.transactionConfirmation.findMany({
        where: {
          status: ConfirmationStatus.CONFIRMED,
          apiSent: false,
          apiRetryCount: {
            lt: this.MAX_RETRY_ATTEMPTS,
          },
        },
        orderBy: {
          confirmedAt: 'asc', // Mais antigas primeiro
        },
        take: 10, // Processar no máximo 10 por vez
      });

      if (pendingConfirmations.length === 0) {
        this.logger.log('✅ Nenhuma transação pendente de envio para API');
        this.logger.log(`====================================\n`);
        return;
      }

      this.logger.log(
        `📋 Encontradas ${pendingConfirmations.length} transação(ões) para retentar envio`,
      );

      for (const confirmation of pendingConfirmations) {
        await this.processRetry(confirmation);
      }

      this.logger.log(`====================================\n`);
    } catch (error) {
      this.logger.error('❌ Erro no job de retry:', error);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Processa retry de uma confirmação específica
   */
  private async processRetry(confirmation: any): Promise<void> {
    const retryCount = confirmation.apiRetryCount + 1;

    try {
      this.logger.log(
        `🔄 Tentativa ${retryCount}/${this.MAX_RETRY_ATTEMPTS} - ID: ${confirmation.id}`,
      );

      // Tentar enviar para API
      const result = await this.registrationService.sendConfirmedTransactionToApi(confirmation);

      if (result.success) {
        // Sucesso!
        await this.prisma.transactionConfirmation.update({
          where: { id: confirmation.id },
          data: {
            apiSent: true,
            apiSentAt: new Date(),
            apiTransactionId: result.transactionId,
            apiError: null,
            apiRetryCount: retryCount,
          },
        });

        this.logger.log(`✅ Transação enviada com sucesso após ${retryCount} tentativa(s)`);

        // Notificar sucesso no Discord se houve retries
        if (retryCount > 1) {
          await this.discordNotification.notifyApiRetrySuccess({
            confirmationId: confirmation.id,
            phoneNumber: confirmation.phoneNumber,
            amount: Number(confirmation.amount),
            retryCount,
            transactionId: result.transactionId!,
          });
        }
      } else {
        // Falhou novamente
        await this.prisma.transactionConfirmation.update({
          where: { id: confirmation.id },
          data: {
            apiError: result.error || 'Erro desconhecido',
            apiRetryCount: retryCount,
          },
        });

        this.logger.warn(
          `⚠️  Falha na tentativa ${retryCount}/${this.MAX_RETRY_ATTEMPTS}: ${result.error}`,
        );

        // Se atingiu o máximo de tentativas, notificar Discord
        if (retryCount >= this.MAX_RETRY_ATTEMPTS) {
          this.logger.error(
            `❌ MÁXIMO DE TENTATIVAS ATINGIDO (${this.MAX_RETRY_ATTEMPTS}) - ID: ${confirmation.id}`,
          );

          await this.discordNotification.notifyApiError({
            confirmationId: confirmation.id,
            phoneNumber: confirmation.phoneNumber,
            amount: Number(confirmation.amount),
            error: result.error || 'Erro desconhecido',
            retryCount,
          });
        }
      }
    } catch (error: any) {
      this.logger.error(`❌ Erro ao processar retry:`, error);

      await this.prisma.transactionConfirmation.update({
        where: { id: confirmation.id },
        data: {
          apiError: error.message || 'Erro desconhecido',
          apiRetryCount: retryCount,
        },
      });
    }
  }
}
