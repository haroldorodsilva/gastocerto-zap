import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { ServiceAuthService } from '../services/service-auth.service';

/**
 * ServiceAuthGuard
 * Valida autenticação HMAC entre serviços
 *
 * Uso:
 * @UseGuards(ServiceAuthGuard)
 * @Post('/admin/some-endpoint')
 * async adminEndpoint() { ... }
 */
@Injectable()
export class ServiceAuthGuard implements CanActivate {
  private readonly logger = new Logger(ServiceAuthGuard.name);

  constructor(private readonly serviceAuthService: ServiceAuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    const serviceId = request.headers['x-service-id'] as string;
    const timestamp = request.headers['x-timestamp'] as string;
    const signature = request.headers['x-signature'] as string;

    if (!serviceId || !timestamp || !signature) {
      this.logger.warn('Missing authentication headers');
      throw new UnauthorizedException('Missing service authentication headers');
    }

    const isValid = this.serviceAuthService.validateRequest(
      serviceId,
      timestamp,
      signature,
      request.body,
    );

    if (!isValid) {
      throw new UnauthorizedException('Invalid service authentication');
    }

    // Adiciona serviceId no request para uso posterior
    (request as any).serviceId = serviceId;

    return true;
  }
}
