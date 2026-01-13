import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { WhatsAppMessageHandler } from './handlers/whatsapp-message.handler';

@Processor('whatsapp-messages')
export class MessagesProcessor {
  private readonly logger = new Logger(MessagesProcessor.name);

  constructor(private readonly whatsAppHandler: WhatsAppMessageHandler) {}

  @Process('process-message')
  async handleProcessMessage(job: Job) {
    this.logger.debug(`Processing job ${job.id}`);

    try {
      await this.whatsAppHandler.processMessage(job.data);
      return { success: true };
    } catch (error) {
      this.logger.error(`Job ${job.id} failed: ${error.message}`);
      throw error;
    }
  }
}
