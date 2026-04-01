import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ServiceAuthService } from '@common/services/service-auth.service';
import { DiscordNotificationService } from '@common/services/discord-notification.service';

/**
 * Base class for domain-specific GastoCerto API clients.
 * Provides shared infrastructure: HTTP request helpers, error handling,
 * Discord notifications, and HMAC authentication.
 */
export abstract class GastoCertoApiClientBase {
  protected readonly logger: Logger;
  protected readonly baseUrl: string;
  protected readonly timeout: number;

  constructor(
    loggerContext: string,
    protected readonly configService: ConfigService,
    protected readonly httpService: HttpService,
    protected readonly serviceAuthService: ServiceAuthService,
    protected readonly discordNotification: DiscordNotificationService,
  ) {
    this.logger = new Logger(loggerContext);
    this.baseUrl = this.configService.get<string>('gastoCertoApi.baseUrl')!;
    this.timeout = this.configService.get<number>('gastoCertoApi.timeout', 30000);
  }

  // ─── Shared HTTP helpers ────────────────────────────────────

  protected async get<T>(path: string, hmacPayload?: any): Promise<T> {
    const hmacHeaders = this.serviceAuthService.generateAuthHeaders(hmacPayload);
    const response = await firstValueFrom(
      this.httpService.get<T>(`${this.baseUrl}${path}`, {
        headers: { ...hmacHeaders, 'Content-Type': 'application/json' },
        timeout: this.timeout,
      }),
    );
    return response.data;
  }

  protected async post<T>(path: string, body: any, hmacPayload?: any, extraConfig?: Record<string, any>): Promise<T> {
    const hmacHeaders = this.serviceAuthService.generateAuthHeaders(hmacPayload ?? body);
    const response = await firstValueFrom(
      this.httpService.post<T>(`${this.baseUrl}${path}`, body, {
        headers: { ...hmacHeaders, 'Content-Type': 'application/json' },
        timeout: this.timeout,
        ...extraConfig,
      }),
    );
    return response.data;
  }

  protected async patch<T>(path: string, body: any, hmacPayload?: any): Promise<T> {
    const hmacHeaders = this.serviceAuthService.generateAuthHeaders(hmacPayload ?? body);
    const response = await firstValueFrom(
      this.httpService.patch<T>(`${this.baseUrl}${path}`, body, {
        headers: { ...hmacHeaders, 'Content-Type': 'application/json' },
        timeout: this.timeout,
      }),
    );
    return response.data;
  }

  // ─── Error handling ─────────────────────────────────────────

  /**
   * Centralized API error handler.
   * Logs technical details, notifies Discord for critical errors,
   * and returns a user-friendly error message.
   */
  protected async handleApiError(
    error: any,
    context: string,
    metadata?: Record<string, any>,
    notifyDiscord = true,
  ): Promise<string> {
    const status = error.response?.status;
    const statusText = error.response?.statusText;
    const errorCode = error.code;
    const errorMessage = error.message;
    const responseData = error.response?.data;

    this.logger.error(
      `❌ [${context}] Erro na API GastoCerto:`,
      { status, statusText, errorCode, errorMessage, responseData, metadata },
      error.stack,
    );

    const shouldNotify =
      notifyDiscord &&
      (status >= 500 ||
        errorCode === 'ECONNREFUSED' ||
        errorCode === 'ETIMEDOUT' ||
        errorCode === 'ENOTFOUND');

    if (shouldNotify) {
      this.discordNotification
        .notify({
          title: `🚨 Erro API - ${context}`,
          description: `Falha ao comunicar com API externa do Gasto Certo`,
          color: 'error',
          fields: [
            { name: '🔧 Operação', value: context, inline: true },
            {
              name: '📡 Status HTTP',
              value: status ? `${status} ${statusText}` : errorCode || 'N/A',
              inline: true,
            },
            {
              name: '💾 Dados',
              value: metadata ? JSON.stringify(metadata).substring(0, 500) : 'N/A',
              inline: false,
            },
            { name: '❌ Mensagem', value: errorMessage || 'Erro desconhecido', inline: false },
            {
              name: '📄 Response',
              value: responseData ? JSON.stringify(responseData).substring(0, 500) : 'N/A',
              inline: false,
            },
          ],
        })
        .catch((discordError) => {
          this.logger.warn(`Falha ao notificar Discord: ${discordError.message}`);
        });
    }

    return this.getUserFriendlyError(error);
  }

  /**
   * Maps HTTP/network errors to user-friendly messages.
   * Never exposes technical details.
   */
  protected getUserFriendlyError(error: any): string {
    if (error.response?.status === 400) return 'Dados inválidos';
    if (error.response?.status === 401 || error.response?.status === 403)
      return 'Acesso não autorizado';
    if (error.response?.status === 404) return 'Recurso não encontrado';
    if (error.response?.status === 409) return 'Conflito - recurso já existe';
    if (error.response?.status === 422) return 'Dados inválidos ou incompletos';
    if (error.response?.status === 500 || error.response?.status === 502) return 'Erro no servidor';
    if (error.response?.status === 503) return 'Serviço temporariamente indisponível';
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND')
      return 'Serviço temporariamente indisponível';
    if (error.code === 'ETIMEDOUT') return 'Tempo de resposta excedido';
    if (error.code === 'ECONNRESET') return 'Conexão interrompida';
    return 'Não foi possível processar a solicitação';
  }

  /**
   * Logs detailed error info for API calls (common pattern across methods).
   */
  protected logDetailedError(url: string, error: any, extra?: Record<string, string>): void {
    this.logger.error(`   URL: ${url}`);
    this.logger.error(`   Status HTTP: ${error.response?.status || 'N/A'}`);
    this.logger.error(`   Mensagem: ${error.message}`);
    if (extra) {
      for (const [key, value] of Object.entries(extra)) {
        this.logger.error(`   ${key}: ${value}`);
      }
    }
    if (error.response?.data) {
      this.logger.error(`   Resposta da API:`, JSON.stringify(error.response.data));
    }
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      this.logger.error(`   ⚠️  API está OFFLINE ou inacessível`);
    }
    if (error.code === 'ETIMEDOUT') {
      this.logger.error(`   ⚠️  TIMEOUT - API não respondeu em ${this.timeout}ms`);
    }
  }
}
