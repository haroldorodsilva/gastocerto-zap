import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { TransactionConfirmationService } from '../transaction-confirmation.service';
import { TransactionsService } from '../transactions.service';
import { UserCacheService } from '@features/users/user-cache.service';
import { IFilteredMessage } from '@infrastructure/messaging/messages/message-filter.service';

export interface ConfirmationJob {
  phoneNumber: string;
  response: string;
}

export interface CreateConfirmationJob {
  userId: string;
  phoneNumber: string;
  message: IFilteredMessage;
  timestamp: number;
  accountId?: string;
}

@Processor('transaction-confirmation')
export class TransactionConfirmationProcessor {
  private readonly logger = new Logger(TransactionConfirmationProcessor.name);

  constructor(
    private readonly confirmationService: TransactionConfirmationService,
    private readonly transactionsService: TransactionsService,
    private readonly userCache: UserCacheService,
  ) {}

  /**
   * Processa confirmação de resposta (sim/não)
   */
  @Process('process-confirmation')
  async handleConfirmation(job: Job<ConfirmationJob>) {
    const { phoneNumber, response } = job.data;

    this.logger.log(`✅ Processando confirmação de ${phoneNumber}: "${response}" (Job ${job.id})`);

    try {
      const result = await this.confirmationService.processResponse(phoneNumber, response);

      if (result.action === 'confirmed') {
        this.logger.log(`✅ Transação confirmada por ${phoneNumber}`);
      } else if (result.action === 'rejected') {
        this.logger.log(`❌ Transação rejeitada por ${phoneNumber}`);
      } else {
        this.logger.log(`⚠️ Resposta inválida de ${phoneNumber}: "${response}"`);
      }

      return result;
    } catch (error: any) {
      this.logger.error(
        `❌ Erro ao processar confirmação de ${phoneNumber}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Cria nova confirmação de transação a partir de mensagem de texto
   */
  @Process('create-confirmation')
  async handleCreateConfirmation(job: Job<CreateConfirmationJob>) {
    const { userId, phoneNumber, message, accountId } = job.data;

    this.logger.log(
      `📝 Criando confirmação de transação para ${phoneNumber} ` +
      `(Job ${job.id}) | AccountId: ${accountId || 'default'}`,
    );

    try {
      // Buscar usuário
      const user = await this.userCache.getUser(phoneNumber);
      if (!user) {
        throw new Error(`Usuário não encontrado: ${phoneNumber}`);
      }

      // Processar mensagem de texto
      const result = await this.transactionsService.processTextMessage(
        user,
        message.text || '',
        message.messageId,
        'whatsapp',
        phoneNumber, // platformId
        accountId, // ⭐ PASSAR accountId do job
      );

      this.logger.log(
        `✅ Confirmação criada para ${phoneNumber} | ` +
        `AccountId usado: ${accountId || user.activeAccountId}`,
      );

      return result;
    } catch (error: any) {
      this.logger.error(
        `❌ Erro ao criar confirmação para ${phoneNumber}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
}
