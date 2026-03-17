import { Processor, Process } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { TelegramMessageHandler } from './handlers/telegram-message.handler';

@Processor('telegram-messages')
export class TelegramMessagesProcessor {
  private readonly logger = new Logger(TelegramMessagesProcessor.name);

  constructor(private readonly telegramHandler: TelegramMessageHandler) {}

  @Process('process-message')
  async handleProcessMessage(job: Job) {
    this.logger.debug(`Processing Telegram job ${job.id}`);

    try {
      await this.telegramHandler.processMessage(job.data);
      return { success: true };
    } catch (error) {
      this.logger.error(`Telegram job ${job.id} failed: ${error.message}`);
      throw error;
    }
  }
}
