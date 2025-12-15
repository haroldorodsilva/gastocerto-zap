import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: DiscordEmbedField[];
  timestamp?: string;
  footer?: {
    text: string;
  };
}

@Injectable()
export class DiscordNotificationService {
  private readonly logger = new Logger(DiscordNotificationService.name);
  private readonly webhookUrl: string;
  private readonly enabled: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {
    this.webhookUrl = this.configService.get<string>('DISCORD_WEBHOOK_URL') || '';
    this.enabled = this.webhookUrl && this.webhookUrl.includes('discord.com/api/webhooks');

    if (!this.enabled) {
      this.logger.warn('⚠️  Discord webhook não configurado. Notificações desabilitadas.');
    }
  }

  /**
   * Envia notificação de erro de API para Discord
   */
  async notifyApiError(params: {
    confirmationId: string;
    phoneNumber: string;
    amount: number;
    error: string;
    retryCount: number;
  }): Promise<void> {
    if (!this.enabled) return;

    try {
      const embed: DiscordEmbed = {
        title: '❌ Erro ao Enviar Transação para API',
        description: 'Falha ao registrar transação no Gasto Certo',
        color: 0xff0000, // Vermelho
        fields: [
          {
            name: '🆔 ID Confirmação',
            value: params.confirmationId,
            inline: false,
          },
          {
            name: '📱 Telefone',
            value: params.phoneNumber,
            inline: true,
          },
          {
            name: '💰 Valor',
            value: `R$ ${(params.amount / 100).toFixed(2)}`,
            inline: true,
          },
          {
            name: '🔄 Tentativas',
            value: `${params.retryCount}`,
            inline: true,
          },
          {
            name: '❌ Erro',
            value: this.truncate(params.error, 1024),
            inline: false,
          },
        ],
        timestamp: new Date().toISOString(),
        footer: {
          text: 'GastoCerto ZAP',
        },
      };

      await this.sendWebhook({ embeds: [embed] });
      this.logger.log(`✅ Notificação enviada para Discord: ${params.confirmationId}`);
    } catch (error) {
      this.logger.error(`❌ Erro ao enviar notificação Discord:`, error);
    }
  }

  /**
   * Envia notificação de retry bem sucedido
   */
  async notifyApiRetrySuccess(params: {
    confirmationId: string;
    phoneNumber: string;
    amount: number;
    retryCount: number;
    transactionId: string;
  }): Promise<void> {
    if (!this.enabled) return;

    try {
      const embed: DiscordEmbed = {
        title: '✅ Transação Enviada com Sucesso (Retry)',
        description: 'Transação foi registrada após tentativas de retry',
        color: 0x00ff00, // Verde
        fields: [
          {
            name: '🆔 ID Confirmação',
            value: params.confirmationId,
            inline: false,
          },
          {
            name: '📱 Telefone',
            value: params.phoneNumber,
            inline: true,
          },
          {
            name: '💰 Valor',
            value: `R$ ${(params.amount / 100).toFixed(2)}`,
            inline: true,
          },
          {
            name: '🔄 Tentativas',
            value: `${params.retryCount}`,
            inline: true,
          },
          {
            name: '🎯 ID Transação',
            value: params.transactionId,
            inline: false,
          },
        ],
        timestamp: new Date().toISOString(),
        footer: {
          text: 'GastoCerto ZAP',
        },
      };

      await this.sendWebhook({ embeds: [embed] });
    } catch (error) {
      this.logger.error(`❌ Erro ao enviar notificação Discord:`, error);
    }
  }

  /**
   * Envia notificação customizada
   */
  async notify(params: {
    title: string;
    description: string;
    color?: 'success' | 'error' | 'warning' | 'info';
    fields?: DiscordEmbedField[];
  }): Promise<void> {
    if (!this.enabled) return;

    const colorMap = {
      success: 0x00ff00,
      error: 0xff0000,
      warning: 0xffa500,
      info: 0x0099ff,
    };

    try {
      const embed: DiscordEmbed = {
        title: params.title,
        description: params.description,
        color: colorMap[params.color || 'info'],
        fields: params.fields,
        timestamp: new Date().toISOString(),
        footer: {
          text: 'GastoCerto ZAP',
        },
      };

      await this.sendWebhook({ embeds: [embed] });
    } catch (error) {
      this.logger.error(`❌ Erro ao enviar notificação Discord:`, error);
    }
  }

  /**
   * Envia payload para webhook Discord
   */
  private async sendWebhook(payload: any): Promise<void> {
    if (!this.enabled) return;

    await firstValueFrom(
      this.httpService.post(this.webhookUrl, payload, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 5000,
      }),
    );
  }

  /**
   * Trunca texto longo para caber no Discord
   */
  private truncate(text: string, maxLength: number): string {
    if (!text) return 'N/A';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }
}
