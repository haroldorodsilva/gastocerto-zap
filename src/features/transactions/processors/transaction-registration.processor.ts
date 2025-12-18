import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { TransactionConfirmationService } from '../transaction-confirmation.service';

export interface RegistrationJob {
  confirmationId: string;
}

@Processor('transaction-registration')
export class TransactionRegistrationProcessor {
  private readonly logger = new Logger(TransactionRegistrationProcessor.name);

  constructor(private readonly confirmationService: TransactionConfirmationService) {}

  @Process()
  async handleRegistration(job: Job<RegistrationJob>) {
    const { confirmationId } = job.data;

    this.logger.log(`💾 Processando registro de transação ${confirmationId} (Job ${job.id})`);

    try {
      // Buscar confirmação
      const confirmation = await this.confirmationService.getById(confirmationId);

      if (!confirmation) {
        throw new Error(`Confirmação ${confirmationId} não encontrada`);
      }

      // Processar como confirmação (isso irá chamar registerTransaction internamente)
      const result = await this.confirmationService.processResponse(
        confirmation.phoneNumber,
        'sim',
      );

      this.logger.log(`✅ Transação ${confirmationId} processada com sucesso`);

      return result;
    } catch (error: any) {
      this.logger.error(
        `❌ Erro ao processar transação ${confirmationId}: ${error.message}`,
        error.stack,
      );

      // Lançar erro para retry automático do Bull
      throw error;
    }
  }
}
