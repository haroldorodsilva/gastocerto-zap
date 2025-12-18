import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { TransactionConfirmationService } from '../transaction-confirmation.service';

export interface ConfirmationJob {
  phoneNumber: string;
  response: string;
}

@Processor('transaction-confirmation')
export class TransactionConfirmationProcessor {
  private readonly logger = new Logger(TransactionConfirmationProcessor.name);

  constructor(private readonly confirmationService: TransactionConfirmationService) {}

  @Process()
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
}
