import { Module, Global } from '@nestjs/common';
import { ServiceAuthService } from './services/service-auth.service';
import { JwtValidationService } from './services/jwt-validation.service';
import { ServiceAuthGuard } from './guards/service-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { DualAuthGuard } from './guards/dual-auth.guard';

/**
 * CommonModule
 * Módulo global com serviços compartilhados de autenticação
 * - ServiceAuthService: HMAC para service-to-service
 * - JwtValidationService: Valida JWT do admin via gastocerto-api
 * - Guards: ServiceAuth, JwtAuth, DualAuth
 */
@Global()
@Module({
  providers: [
    ServiceAuthService,
    JwtValidationService,
    ServiceAuthGuard,
    JwtAuthGuard,
    DualAuthGuard,
  ],
  exports: [
    ServiceAuthService,
    JwtValidationService,
    ServiceAuthGuard,
    JwtAuthGuard,
    DualAuthGuard,
  ],
})
export class CommonModule {}
