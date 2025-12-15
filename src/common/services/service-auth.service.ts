import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * ServiceAuthService
 * Autenticação entre serviços usando HMAC SHA-256
 * Sem necessidade de JWT - usa assinatura HMAC + timestamp
 */
@Injectable()
export class ServiceAuthService {
  private readonly logger = new Logger(ServiceAuthService.name);
  private readonly sharedSecret: string;
  private readonly thisServiceId: string;
  private readonly requestTimeoutMs: number;

  constructor(private readonly configService: ConfigService) {
    this.sharedSecret = this.configService.get<string>('serviceAuth.sharedSecret')!;
    this.thisServiceId = this.configService.get<string>('serviceAuth.thisServiceId')!;
    this.requestTimeoutMs = this.configService.get<number>('serviceAuth.requestTimeoutMs')!;

    if (this.sharedSecret === 'changeme-in-production') {
      this.logger.warn('⚠️  SERVICE_SHARED_SECRET not configured! Using default secret.');
    }
  }

  /**
   * Gera headers de autenticação para requisição
   * @param body - Corpo da requisição (será incluído na assinatura)
   * @returns Headers para incluir na requisição HTTP
   */
  generateAuthHeaders(body?: any): Record<string, string> {
    const timestamp = Date.now().toString();
    const bodyStr = body ? JSON.stringify(body) : '';

    const signature = this.generateSignature(timestamp, bodyStr);

    return {
      'x-service-id': this.thisServiceId,
      'x-timestamp': timestamp,
      'x-signature': signature,
    };
  }

  /**
   * Valida requisição recebida de outro serviço
   * @param serviceId - ID do serviço que está chamando
   * @param timestamp - Timestamp da requisição
   * @param signature - Assinatura HMAC
   * @param body - Corpo da requisição
   * @returns true se válido, false caso contrário
   */
  validateRequest(serviceId: string, timestamp: string, signature: string, body?: any): boolean {
    try {
      // 1. Verifica se timestamp não está expirado
      const requestTime = parseInt(timestamp);
      const now = Date.now();
      const diff = now - requestTime;

      if (diff < 0 || diff > this.requestTimeoutMs) {
        this.logger.warn(`Request from ${serviceId} expired or future timestamp. Diff: ${diff}ms`);
        return false;
      }

      // 2. Valida assinatura
      const bodyStr = body ? JSON.stringify(body) : '';
      const expectedSignature = this.generateSignature(timestamp, bodyStr);

      if (!this.secureCompare(signature, expectedSignature)) {
        this.logger.warn(`Invalid signature from service: ${serviceId}`);
        return false;
      }

      this.logger.debug(`✅ Valid request from service: ${serviceId}`);
      return true;
    } catch (error) {
      this.logger.error(`Error validating request: ${error.message}`);
      return false;
    }
  }

  /**
   * Gera assinatura HMAC SHA-256
   */
  private generateSignature(timestamp: string, body: string): string {
    const payload = `${timestamp}:${body}`;
    return crypto.createHmac('sha256', this.sharedSecret).update(payload).digest('hex');
  }

  /**
   * Comparação segura contra timing attacks
   */
  private secureCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }

    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }
}
