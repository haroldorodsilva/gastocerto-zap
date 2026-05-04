import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@core/database/prisma.service';
import { PlatformReplyService } from '@infrastructure/messaging/messages/platform-reply.service';
import { ConfirmationStatus } from '@prisma/client';

/**
 * Job para monitorar e notificar expirações de confirmações
 *
 * Executa a cada 30 segundos e:
 * 1. Avisa confirmações que expiram em menos de 30 segundos
 * 2. Marca como expiradas (REJECTED) as confirmações que já passaram do prazo
 */
@Injectable()
export class ConfirmationExpirationJob {
  private readonly logger = new Logger(ConfirmationExpirationJob.name);
  private readonly WARNING_THRESHOLD_SECONDS = 30; // Avisar 30s antes de expirar

  constructor(
    private readonly prisma: PrismaService,
    private readonly platformReply: PlatformReplyService,
  ) {}

  /**
   * Helper para emitir eventos de resposta para a plataforma correta
   * Usa a coluna platform da confirmação
   */
  private async emitReply(
    confirmation: any,
    message: string,
    context: string,
    metadata?: any,
  ): Promise<void> {
    try {
      const platform = confirmation.platform || 'whatsapp';

      await this.platformReply.sendReply({
        platformId: confirmation.phoneNumber,
        message,
        context,
        platform,
        metadata,
      });
    } catch (error) {
      this.logger.error(`❌ Erro ao emitir reply para ${confirmation.phoneNumber}:`, error);
    }
  }

  /**
   * Job executado a cada 30 segundos
   * Verifica confirmações pendentes próximas de expirar
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async checkExpiringConfirmations() {
    try {
      const now = new Date();

      // Saída rápida se não há nenhuma confirmação pendente no sistema
      const hasPending = await this.prisma.transactionConfirmation.count({
        where: { status: ConfirmationStatus.PENDING, deletedAt: null },
      });
      if (hasPending === 0) return;

      const warningTime = new Date(now.getTime() + this.WARNING_THRESHOLD_SECONDS * 1000);

      // Buscar confirmações pendentes que expiram nos próximos 30 segundos
      // e ainda não foram notificadas
      const expiringSoon = await this.prisma.transactionConfirmation.findMany({
        where: {
          status: ConfirmationStatus.PENDING,
          deletedAt: null,
          expiresAt: {
            lte: warningTime,
            gt: now,
          },
          notifiedExpiring: false,
        },
      });

      if (expiringSoon.length > 0) {
        this.logger.log(
          `⏰ Encontradas ${expiringSoon.length} confirmação(ões) expirando em breve`,
        );

        for (const confirmation of expiringSoon) {
          await this.notifyExpiring(confirmation);
        }
      }

      // Buscar confirmações que já expiraram
      const expired = await this.prisma.transactionConfirmation.findMany({
        where: {
          status: ConfirmationStatus.PENDING,
          deletedAt: null,
          expiresAt: {
            lte: now,
          },
        },
      });

      if (expired.length > 0) {
        this.logger.log(`❌ Encontradas ${expired.length} confirmação(ões) expiradas`);

        for (const confirmation of expired) {
          await this.markAsExpired(confirmation);
        }
      }
    } catch (error) {
      this.logger.error(`Erro ao verificar expirações:`, error);
    }
  }

  /**
   * Notifica usuário que confirmação está prestes a expirar
   */
  private async notifyExpiring(confirmation: any) {
    try {
      const secondsLeft = Math.floor(
        (new Date(confirmation.expiresAt).getTime() - Date.now()) / 1000,
      );

      const typeEmoji = confirmation.type === 'EXPENSES' ? '💸' : '💰';
      const typeText = confirmation.type === 'EXPENSES' ? 'Gasto' : 'Receita';
      const amount = (Number(confirmation.amount) / 100).toFixed(2);
      const subCategoryText = confirmation.subCategoryName
        ? ` > ${confirmation.subCategoryName}`
        : '';

      const message =
        `⏰ *Atenção: Confirmação expirando!*\n\n` +
        `Sua confirmação de ${typeText.toLowerCase()} expira em *${secondsLeft} segundos*.\n\n` +
        `${typeEmoji} *Valor:* R$ ${amount}\n` +
        `📂 *Categoria:* ${confirmation.category}${subCategoryText}\n` +
        `${confirmation.description ? `📝 *Descrição:* ${confirmation.description}\n` : ''}` +
        `\n✅ Digite *"sim"* para confirmar\n` +
        `❌ Digite *"não"* para cancelar`;

      // Emitir evento para enviar mensagem
      await this.emitReply(confirmation, message, 'CONFIRMATION_REQUEST', {
        confirmationId: confirmation.id,
        action: 'expiring_warning',
        secondsLeft,
      });

      // Marcar como notificado
      await this.prisma.transactionConfirmation.update({
        where: { id: confirmation.id, deletedAt: null },
        data: { notifiedExpiring: true },
      });

      this.logger.log(
        `⏰ Aviso de expiração enviado | Confirmation: ${confirmation.id} | Expires in: ${secondsLeft}s`,
      );
    } catch (error) {
      this.logger.error(`Erro ao notificar expiração:`, error);
    }
  }

  /**
   * Marca confirmação como expirada e notifica usuário
   */
  private async markAsExpired(confirmation: any) {
    try {
      // Atualizar status para REJECTED
      await this.prisma.transactionConfirmation.update({
        where: { id: confirmation.id, deletedAt: null },
        data: {
          status: ConfirmationStatus.REJECTED,
        },
      });

      const typeEmoji = confirmation.type === 'EXPENSES' ? '💸' : '💰';
      const typeText = confirmation.type === 'EXPENSES' ? 'Gasto' : 'Receita';
      const amount = (Number(confirmation.amount) / 100).toFixed(2);
      const subCategoryText = confirmation.subCategoryName
        ? ` > ${confirmation.subCategoryName}`
        : '';

      const message =
        `⏱️ *Confirmação expirada*\n\n` +
        `Sua confirmação de ${typeText.toLowerCase()} expirou sem resposta.\n\n` +
        `${typeEmoji} *Valor:* R$ ${amount}\n` +
        `📂 *Categoria:* ${confirmation.category}${subCategoryText}\n` +
        `${confirmation.description ? `📝 *Descrição:* ${confirmation.description}\n` : ''}` +
        `\n💡 *Dica:* Envie a transação novamente se ainda quiser registrar.`;

      // Emitir evento para enviar mensagem
      await this.emitReply(confirmation, message, 'TRANSACTION_RESULT', {
        confirmationId: confirmation.id,
        action: 'expired',
      });

      this.logger.log(`❌ Confirmação expirada e marcada como REJECTED | ID: ${confirmation.id}`);
    } catch (error) {
      this.logger.error(`Erro ao marcar confirmação como expirada:`, error);
    }
  }

  /**
   * Job executado a cada 5 minutos
   * Limpa apenas confirmações JÁ ENVIADAS para API (apiSent: true)
   * ⚠️ NÃO apaga REJECTED - mantém para análise posterior
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async cleanupOldConfirmations() {
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

      const result = await this.prisma.transactionConfirmation.updateMany({
        where: {
          apiSent: true, // Apenas registros já enviados com sucesso
          deletedAt: null,
          expiresAt: {
            lt: oneHourAgo,
          },
        },
        data: {
          deletedAt: new Date(), // Soft delete
        },
      });

      if (result.count > 0) {
        this.logger.log(`🧹 Limpeza: ${result.count} confirmação(ões) antigas removidas`);
      }
    } catch (error) {
      this.logger.error(`Erro ao limpar confirmações antigas:`, error);
    }
  }
}
