import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';
import { CryptoUtil } from '@core/utils/crypto.util';

/**
 * Interceptor para validar assinatura HMAC de requests da API GastoCerto
 * Protege contra man-in-the-middle e replay attacks
 */
@Injectable()
export class SignatureInterceptor implements NestInterceptor {
  private readonly logger = new Logger(SignatureInterceptor.name);
  private readonly secret: string;

  constructor(private configService: ConfigService) {
    this.secret = this.configService.get<string>('SERVICE_CLIENT_SECRET') || '';
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();

    // Headers esperados
    const signature = request.headers['x-signature'];
    const timestamp = request.headers['x-timestamp'];

    // Validar presença de headers
    if (!signature || !timestamp) {
      this.logger.warn('Request sem assinatura ou timestamp');
      throw new UnauthorizedException('Assinatura ou timestamp ausente');
    }

    // Validar timestamp (proteção contra replay attack)
    const timestampNum = parseInt(timestamp, 10);
    if (!CryptoUtil.validateTimestamp(timestampNum, 300)) {
      this.logger.warn(`Timestamp inválido ou expirado: ${timestamp}`);
      throw new UnauthorizedException('Timestamp inválido ou expirado');
    }

    // Construir payload para validação
    const payload = {
      method: request.method,
      path: request.path,
      body: request.body,
      timestamp: timestampNum,
    };

    // Validar assinatura
    const isValid = CryptoUtil.verifySignature(payload, signature, this.secret);

    if (!isValid) {
      this.logger.warn('Assinatura inválida');
      throw new UnauthorizedException('Assinatura inválida');
    }

    this.logger.debug('Assinatura validada com sucesso');

    return next.handle();
  }
}
