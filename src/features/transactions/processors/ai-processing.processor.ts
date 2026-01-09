import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { TransactionsService } from '../transactions.service';
import { UserCacheService } from '@features/users/user-cache.service';

export interface AIProcessingJob {
  phoneNumber: string;
  messageId: string;
  messageType: 'text' | 'image' | 'audio';
  content: string | Buffer;
  mimeType?: string;
}

@Processor('ai-processing')
export class AIProcessingProcessor {
  private readonly logger = new Logger(AIProcessingProcessor.name);

  constructor(
    private readonly transactionsService: TransactionsService,
    private readonly userCache: UserCacheService,
  ) {}

  @Process()
  async handleAIProcessing(job: Job<AIProcessingJob>) {
    const { phoneNumber, messageId, messageType, content, mimeType } = job.data;

    this.logger.log(`🤖 Processando ${messageType} de ${phoneNumber} (Job ${job.id})`);

    try {
      // Buscar usuário uma única vez
      const user = await this.userCache.getUser(phoneNumber);
      if (!user) {
        throw new Error(`Usuário não encontrado: ${phoneNumber}`);
      }

      let result;

      switch (messageType) {
        case 'text':
          result = await this.transactionsService.processTextMessage(
            user,
            content as string,
            messageId,
          );
          break;

        case 'image':
          result = await this.transactionsService.processImageMessage(
            user,
            content as Buffer,
            mimeType || 'image/jpeg',
            messageId,
          );
          break;

        case 'audio':
          result = await this.transactionsService.processAudioMessage(
            user,
            content as Buffer,
            mimeType || 'audio/ogg',
            messageId,
          );
          break;

        default:
          throw new Error(`Tipo de mensagem não suportado: ${messageType}`);
      }

      this.logger.log(`✅ AI processing completo para ${phoneNumber}: ${result.message}`);

      return result;
    } catch (error: any) {
      this.logger.error(
        `❌ Erro no processamento AI para ${phoneNumber}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }
}
