import { Module, Global } from '@nestjs/common';
import { ServiceAuthService } from './services/service-auth.service';
import { JwtValidationService } from './services/jwt-validation.service';
import { UserRateLimiterService } from './services/user-rate-limiter.service';
import { RedisService } from './services/redis.service';
import { TemporalParserService } from './services/temporal-parser.service';
import { ServiceAuthGuard } from './guards/service-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtUserGuard } from './guards/jwt-user.guard';
import { DualAuthGuard } from './guards/dual-auth.guard';

/**
 * CommonModule
 * Módulo global com serviços compartilhados
 * - ServiceAuthService: HMAC para service-to-service
 * - JwtValidationService: Valida JWT do admin via gastocerto-api
 * - UserRateLimiterService: Rate limiting para proteção contra spam
 * - RedisService: Cliente Redis para cache e rate limiting
 * - TemporalParserService: Parser NLP para expressões temporais
 * - Guards: ServiceAuth, JwtAuth (admin), JwtUser (any role), DualAuth
 */
@Global()
@Module({
  providers: [
    ServiceAuthService,
    JwtValidationService,
    UserRateLimiterService,
    RedisService,
    TemporalParserService,
    ServiceAuthGuard,
    JwtAuthGuard,
    JwtUserGuard,
    DualAuthGuard,
  ],
  exports: [
    ServiceAuthService,
    JwtValidationService,
    UserRateLimiterService,
    RedisService,
    TemporalParserService,
    ServiceAuthGuard,
    JwtAuthGuard,
    JwtUserGuard,
    DualAuthGuard,
  ],
})
export class CommonModule {}
