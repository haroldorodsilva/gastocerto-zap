import { Controller, Get, Logger, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { JwtValidationService } from '@common/services/jwt-validation.service';

/**
 * Controller para testes de autenticação JWT
 * APENAS para desenvolvimento/debug
 */
@ApiTags('Auth Test')
@Controller('auth-test')
export class AuthTestController {
  private readonly logger = new Logger(AuthTestController.name);

  constructor(private readonly jwtValidationService: JwtValidationService) {}

  @Get('validate-token')
  @ApiOperation({
    summary: '[DEV] Testar validação de token JWT',
    description: 'Endpoint para debug - valida token JWT e mostra detalhes',
  })
  @ApiQuery({
    name: 'token',
    description: 'Token JWT para validar',
    required: true,
  })
  async validateToken(@Query('token') token: string) {
    this.logger.log(`[Auth Test] Validating token...`);

    try {
      // Decodifica JWT para mostrar payload (sem validar assinatura ainda)
      const parts = token.split('.');
      let decodedPayload = null;

      if (parts.length === 3) {
        try {
          decodedPayload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
          const now = Math.floor(Date.now() / 1000);
          decodedPayload._debug = {
            isExpired: now > decodedPayload.exp,
            timeUntilExpiry: decodedPayload.exp - now,
            issuedAt: new Date(decodedPayload.iat * 1000).toISOString(),
            expiresAt: new Date(decodedPayload.exp * 1000).toISOString(),
            currentTime: new Date(now * 1000).toISOString(),
          };
        } catch (e) {
          this.logger.error('Failed to decode JWT payload');
        }
      }

      // Valida token com gastocerto-api
      const user = await this.jwtValidationService.validateToken(token);

      return {
        success: !!user,
        decodedPayload,
        validatedUser: user,
        message: user
          ? 'Token is valid and user authenticated'
          : 'Token validation failed - check logs for details',
      };
    } catch (error: any) {
      this.logger.error(`Error validating token: ${error.message}`);
      return {
        success: false,
        error: error.message,
        message: 'Token validation failed with error',
      };
    }
  }

  @Get('health')
  @ApiOperation({
    summary: '[DEV] Verificar status da autenticação',
    description: 'Mostra configuração de autenticação e conectividade',
  })
  async health() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      apiUrl: process.env.GASTO_CERTO_API_URL,
      devBypass: process.env.DEV_AUTH_BYPASS === 'true',
    };
  }
}
