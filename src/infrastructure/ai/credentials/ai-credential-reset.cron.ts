import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AICredentialSelectorService } from './ai-credential-selector.service';

/**
 * 🆕 [AI4] Reseta diariamente o flag `isExhausted` das credenciais de IA.
 *
 * Roda às 00:00 (timezone do servidor) — assim no dia seguinte as chaves
 * que estouraram quota voltam ao pool round-robin.
 */
@Injectable()
export class AICredentialResetCron {
  private readonly logger = new Logger(AICredentialResetCron.name);

  constructor(private readonly selector: AICredentialSelectorService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { name: 'ai-credential-daily-reset' })
  async handleDailyReset(): Promise<void> {
    try {
      const count = await this.selector.resetExhausted();
      if (count === 0) {
        this.logger.debug('♻️  [AI4] Nenhuma credencial precisava de reset hoje');
      }
    } catch (err) {
      this.logger.error('❌ Falha no reset diário de credenciais:', err);
    }
  }
}
