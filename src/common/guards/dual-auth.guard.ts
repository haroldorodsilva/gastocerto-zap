import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { ServiceAuthService } from '../services/service-auth.service';
import { JwtValidationService } from '../services/jwt-validation.service';

/**
 * DualAuthGuard
 * Aceita tanto autenticação JWT (admin frontend) quanto HMAC (service-to-service)
 *
 * Casos de uso:
 * 1. Admin dashboard (gastocerto-admin) -> usa JWT
 * 2. Service-to-service (gastocerto-api) -> usa HMAC
 *
 * Tentativas:
 * 1. Verifica se tem Authorization: Bearer <token> -> tenta JWT
 * 2. Verifica se tem X-Service-ID + X-Signature -> tenta HMAC
 * 3. Se nenhum funcionar -> UnauthorizedException
 *
 * Uso:
 * @UseGuards(DualAuthGuard)
 * @Get('/sessions')
 * async listSessions() { ... }
 */
@Injectable()
export class DualAuthGuard implements CanActivate {
  private readonly logger = new Logger(DualAuthGuard.name);

  constructor(
    private readonly serviceAuthService: ServiceAuthService,
    private readonly jwtValidationService: JwtValidationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    // Tenta autenticação JWT (Admin frontend)
    const jwtResult = await this.tryJwtAuth(request);
    if (jwtResult) {
      this.logger.debug('✅ Authenticated via JWT');
      return true;
    }

    // Tenta autenticação HMAC (Service-to-service)
    const hmacResult = this.tryHmacAuth(request);
    if (hmacResult) {
      this.logger.debug('✅ Authenticated via HMAC');
      return true;
    }

    // Nenhuma autenticação funcionou
    this.logger.warn('Authentication failed: No valid JWT or HMAC');
    throw new UnauthorizedException('Authentication required: Provide JWT token or HMAC signature');
  }

  /**
   * Tenta autenticação JWT
   */
  private async tryJwtAuth(request: Request): Promise<boolean> {
    try {
      const authHeader = request.headers.authorization as string;
      const token = this.jwtValidationService.extractTokenFromHeader(authHeader);

      if (!token) {
        return false;
      }

      const user = await this.jwtValidationService.validateToken(token);

      if (!user || !['ADMIN', 'MASTER'].includes(user.role)) {
        return false;
      }

      // Adiciona user no request
      (request as any).user = user;
      (request as any).authType = 'jwt';

      return true;
    } catch (error) {
      this.logger.debug(`JWT auth failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Tenta autenticação HMAC
   */
  private tryHmacAuth(request: Request): boolean {
    try {
      const serviceId = request.headers['x-service-id'] as string;
      const timestamp = request.headers['x-timestamp'] as string;
      const signature = request.headers['x-signature'] as string;

      if (!serviceId || !timestamp || !signature) {
        return false;
      }

      const isValid = this.serviceAuthService.validateRequest(
        serviceId,
        timestamp,
        signature,
        request.body,
      );

      if (!isValid) {
        return false;
      }

      // Adiciona serviceId no request
      (request as any).serviceId = serviceId;
      (request as any).authType = 'hmac';

      return true;
    } catch (error) {
      this.logger.debug(`HMAC auth failed: ${error.message}`);
      return false;
    }
  }
}
