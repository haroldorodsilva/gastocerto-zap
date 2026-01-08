import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtValidationService } from '../services/jwt-validation.service';

/**
 * JwtUserGuard
 * Valida JWT token do gastocerto-admin (frontend)
 * Aceita qualquer usuário autenticado (não requer ADMIN)
 *
 * Fluxo:
 * 1. Usuário faz login no gastocerto-admin
 * 2. Recebe JWT token
 * 3. Frontend envia: Authorization: Bearer <token>
 * 4. Este guard valida o token chamando gastocerto-api
 * 5. Aceita qualquer role (USER, ADMIN, MASTER)
 *
 * Uso:
 * @UseGuards(JwtUserGuard)
 * @Post('/webchat/message')
 * async sendMessage() { ... }
 */
@Injectable()
export class JwtUserGuard implements CanActivate {
  private readonly logger = new Logger(JwtUserGuard.name);

  constructor(private readonly jwtValidationService: JwtValidationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    // Extrai token do Authorization header
    const authHeader = request.headers.authorization as string;

    this.logger.debug(
      `[JWT User Guard] Authorization header: ${authHeader ? 'Present' : 'Missing'}`,
    );

    const token = this.jwtValidationService.extractTokenFromHeader(authHeader);

    if (!token) {
      this.logger.warn('Missing or invalid Authorization header');
      throw new UnauthorizedException('Missing or invalid authorization token');
    }

    this.logger.debug(`[JWT User Guard] Token extracted, validating with gastocerto-api...`);

    // Valida token com gastocerto-api (sem validar role)
    const user = await this.jwtValidationService.validateTokenAnyRole(token);

    if (!user) {
      this.logger.warn('Invalid or expired token - API validation failed');
      throw new UnauthorizedException('Invalid or expired token');
    }

    // Adiciona user no request para uso posterior
    (request as any).user = user;

    this.logger.debug(`✅ Authenticated: ${user.email} (${user.role})`);
    return true;
  }
}
