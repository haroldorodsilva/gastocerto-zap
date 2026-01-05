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
 * JwtAuthGuard
 * Valida JWT token do gastocerto-admin (frontend)
 *
 * Fluxo:
 * 1. Admin faz login no gastocerto-admin
 * 2. Recebe JWT token
 * 3. Frontend envia: Authorization: Bearer <token>
 * 4. Este guard valida o token chamando gastocerto-api
 * 5. Verifica se role é ADMIN ou MASTER
 *
 * Uso:
 * @UseGuards(JwtAuthGuard)
 * @Get('/sessions')
 * async listSessions() { ... }
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(private readonly jwtValidationService: JwtValidationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    // Extrai token do Authorization header
    const authHeader = request.headers.authorization as string;

    this.logger.debug(`[JWT Guard] Authorization header: ${authHeader ? 'Present' : 'Missing'}`);

    const token = this.jwtValidationService.extractTokenFromHeader(authHeader);

    if (!token) {
      this.logger.warn('Missing or invalid Authorization header');
      throw new UnauthorizedException('Missing or invalid authorization token');
    }

    this.logger.debug(`[JWT Guard] Token extracted, validating with gastocerto-api...`);

    // Valida token com gastocerto-api
    const user = await this.jwtValidationService.validateToken(token);

    if (!user) {
      this.logger.warn('Invalid or expired token - API validation failed');
      throw new UnauthorizedException('Invalid or expired token');
    }

    // Valida role (apenas ADMIN ou MASTER)
    if (!['ADMIN', 'MASTER'].includes(user.role)) {
      this.logger.warn(`User ${user.email} is not admin (role: ${user.role})`);
      throw new UnauthorizedException('Insufficient privileges');
    }

    // Adiciona user no request para uso posterior
    (request as any).user = user;

    this.logger.debug(`✅ Authenticated: ${user.email} (${user.role})`);
    return true;
  }
}
