import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from './redis.service';

/**
 * User Rate Limiter Service
 *
 * Protege o sistema contra spam e abuso de usuários.
 *
 * LIMITES:
 * - 10 mensagens por minuto por usuário
 * - 100 mensagens por hora por usuário
 * - 500 mensagens por dia por usuário
 *
 * IMPORTANTE:
 * - Usa Redis para contadores distribuídos
 * - Limites são por phoneNumber (cross-platform)
 * - Bloqueia temporariamente se exceder
 */
@Injectable()
export class UserRateLimiterService {
  private readonly logger = new Logger(UserRateLimiterService.name);

  // Limites configuráveis
  private readonly limits = {
    perMinute: 10, // Máximo 10 mensagens/minuto
    perHour: 100, // Máximo 100 mensagens/hora
    perDay: 500, // Máximo 500 mensagens/dia
  };

  // Duração dos bloqueios (em segundos)
  private readonly blockDurations = {
    firstOffense: 60, // 1 minuto
    secondOffense: 300, // 5 minutos
    thirdOffense: 900, // 15 minutos
    persistent: 3600, // 1 hora
  };

  constructor(private readonly redisService: RedisService) {}

  /**
   * Verifica se usuário pode enviar mensagem
   * Retorna { allowed: boolean, reason?: string, retryAfter?: number }
   */
  async checkLimit(
    phoneNumber: string,
  ): Promise<{ allowed: boolean; reason?: string; retryAfter?: number }> {
    try {
      const redis = this.redisService.getClient();

      // Verificar se está bloqueado
      const blockKey = `ratelimit:user:block:${phoneNumber}`;
      const blockTTL = await redis.ttl(blockKey);

      if (blockTTL > 0) {
        this.logger.warn(`🚫 Usuário ${phoneNumber} está bloqueado (${blockTTL}s restantes)`);
        return {
          allowed: false,
          reason: 'blocked',
          retryAfter: blockTTL,
        };
      }

      // Verificar limites
      const now = Date.now();
      const minute = Math.floor(now / 60000); // Minuto atual
      const hour = Math.floor(now / 3600000); // Hora atual
      const day = Math.floor(now / 86400000); // Dia atual

      const minuteKey = `ratelimit:user:minute:${phoneNumber}:${minute}`;
      const hourKey = `ratelimit:user:hour:${phoneNumber}:${hour}`;
      const dayKey = `ratelimit:user:day:${phoneNumber}:${day}`;

      const [minuteCount, hourCount, dayCount] = await Promise.all([
        redis.get(minuteKey),
        redis.get(hourKey),
        redis.get(dayKey),
      ]);

      const counts = {
        minute: parseInt(minuteCount || '0', 10),
        hour: parseInt(hourCount || '0', 10),
        day: parseInt(dayCount || '0', 10),
      };

      // Verificar limite por minuto
      if (counts.minute >= this.limits.perMinute) {
        await this.handleRateLimitExceeded(phoneNumber, 'minute', counts.minute);
        const retryAfter = 60 - (now % 60000) / 1000; // Segundos até próximo minuto
        return {
          allowed: false,
          reason: 'rate_limit_minute',
          retryAfter: Math.ceil(retryAfter),
        };
      }

      // Verificar limite por hora
      if (counts.hour >= this.limits.perHour) {
        await this.handleRateLimitExceeded(phoneNumber, 'hour', counts.hour);
        const retryAfter = 3600 - (now % 3600000) / 1000; // Segundos até próxima hora
        return {
          allowed: false,
          reason: 'rate_limit_hour',
          retryAfter: Math.ceil(retryAfter),
        };
      }

      // Verificar limite por dia
      if (counts.day >= this.limits.perDay) {
        await this.handleRateLimitExceeded(phoneNumber, 'day', counts.day);
        const retryAfter = 86400 - (now % 86400000) / 1000; // Segundos até próximo dia
        return {
          allowed: false,
          reason: 'rate_limit_day',
          retryAfter: Math.ceil(retryAfter),
        };
      }

      // Passou em todas verificações
      return { allowed: true };
    } catch (error) {
      this.logger.error(`Erro ao verificar rate limit para ${phoneNumber}:`, error);
      // Em caso de erro, permite (fail-open) para não bloquear usuários legítimos
      return { allowed: true };
    }
  }

  /**
   * Registra uso de mensagem
   */
  async recordUsage(phoneNumber: string): Promise<void> {
    try {
      const redis = this.redisService.getClient();
      const now = Date.now();
      const minute = Math.floor(now / 60000);
      const hour = Math.floor(now / 3600000);
      const day = Math.floor(now / 86400000);

      const minuteKey = `ratelimit:user:minute:${phoneNumber}:${minute}`;
      const hourKey = `ratelimit:user:hour:${phoneNumber}:${hour}`;
      const dayKey = `ratelimit:user:day:${phoneNumber}:${day}`;

      // Incrementar contadores com TTL apropriado
      await Promise.all([
        redis.incr(minuteKey).then(() => redis.expire(minuteKey, 120)), // 2 minutos
        redis.incr(hourKey).then(() => redis.expire(hourKey, 7200)), // 2 horas
        redis.incr(dayKey).then(() => redis.expire(dayKey, 172800)), // 2 dias
      ]);
    } catch (error) {
      this.logger.error(`Erro ao registrar uso para ${phoneNumber}:`, error);
    }
  }

  /**
   * Trata excesso de rate limit (bloqueia temporariamente)
   */
  private async handleRateLimitExceeded(
    phoneNumber: string,
    limitType: 'minute' | 'hour' | 'day',
    count: number,
  ): Promise<void> {
    const redis = this.redisService.getClient();
    const offenseKey = `ratelimit:user:offenses:${phoneNumber}`;

    // Incrementar contador de ofensas
    const offenses = await redis.incr(offenseKey);
    await redis.expire(offenseKey, 86400); // Expira em 24h

    // Determinar duração do bloqueio baseado em ofensas
    let blockDuration: number;
    if (offenses === 1) {
      blockDuration = this.blockDurations.firstOffense;
    } else if (offenses === 2) {
      blockDuration = this.blockDurations.secondOffense;
    } else if (offenses === 3) {
      blockDuration = this.blockDurations.thirdOffense;
    } else {
      blockDuration = this.blockDurations.persistent;
    }

    // Bloquear usuário
    const blockKey = `ratelimit:user:block:${phoneNumber}`;
    await redis.setex(blockKey, blockDuration, offenses.toString());

    this.logger.warn(
      `🚫 Usuário ${phoneNumber} BLOQUEADO por ${blockDuration}s (limite ${limitType} excedido: ${count}, ofensas: ${offenses})`,
    );
  }

  /**
   * Obtém estatísticas de uso de um usuário
   */
  async getUserStats(phoneNumber: string): Promise<{
    minute: number;
    hour: number;
    day: number;
    isBlocked: boolean;
    blockTimeRemaining?: number;
    offenses: number;
  }> {
    try {
      const redis = this.redisService.getClient();
      const now = Date.now();
      const minute = Math.floor(now / 60000);
      const hour = Math.floor(now / 3600000);
      const day = Math.floor(now / 86400000);

      const minuteKey = `ratelimit:user:minute:${phoneNumber}:${minute}`;
      const hourKey = `ratelimit:user:hour:${phoneNumber}:${hour}`;
      const dayKey = `ratelimit:user:day:${phoneNumber}:${day}`;
      const blockKey = `ratelimit:user:block:${phoneNumber}`;
      const offenseKey = `ratelimit:user:offenses:${phoneNumber}`;

      const [minuteCount, hourCount, dayCount, blockTTL, offenses] = await Promise.all([
        redis.get(minuteKey),
        redis.get(hourKey),
        redis.get(dayKey),
        redis.ttl(blockKey),
        redis.get(offenseKey),
      ]);

      return {
        minute: parseInt(minuteCount || '0', 10),
        hour: parseInt(hourCount || '0', 10),
        day: parseInt(dayCount || '0', 10),
        isBlocked: blockTTL > 0,
        blockTimeRemaining: blockTTL > 0 ? blockTTL : undefined,
        offenses: parseInt(offenses || '0', 10),
      };
    } catch (error) {
      this.logger.error(`Erro ao obter estatísticas para ${phoneNumber}:`, error);
      return {
        minute: 0,
        hour: 0,
        day: 0,
        isBlocked: false,
        offenses: 0,
      };
    }
  }

  /**
   * Reseta limites de um usuário (admin)
   */
  async resetUserLimits(phoneNumber: string): Promise<void> {
    try {
      const redis = this.redisService.getClient();
      const keys = await redis.keys(`ratelimit:user:*:${phoneNumber}*`);

      if (keys.length > 0) {
        await redis.del(...keys);
        this.logger.log(`🔄 Rate limits resetados para usuário ${phoneNumber}`);
      }
    } catch (error) {
      this.logger.error(`Erro ao resetar limites para ${phoneNumber}:`, error);
    }
  }

  /**
   * Desbloqueia usuário manualmente (admin)
   */
  async unblockUser(phoneNumber: string): Promise<void> {
    try {
      const redis = this.redisService.getClient();
      const blockKey = `ratelimit:user:block:${phoneNumber}`;
      const offenseKey = `ratelimit:user:offenses:${phoneNumber}`;

      await Promise.all([redis.del(blockKey), redis.del(offenseKey)]);

      this.logger.log(`🔓 Usuário ${phoneNumber} desbloqueado manualmente`);
    } catch (error) {
      this.logger.error(`Erro ao desbloquear usuário ${phoneNumber}:`, error);
    }
  }

  /**
   * Retorna mensagem amigável para usuário sobre rate limit
   */
  getRateLimitMessage(reason: string, retryAfter: number): string {
    const minutes = Math.ceil(retryAfter / 60);
    const hours = Math.ceil(retryAfter / 3600);

    switch (reason) {
      case 'blocked':
        return (
          `🚫 *Você está temporariamente bloqueado*\n\n` +
          `Detectamos uso excessivo do sistema.\n\n` +
          `⏳ Aguarde ${retryAfter < 120 ? `${retryAfter} segundos` : retryAfter < 3600 ? `${minutes} minutos` : `${hours} horas`} para continuar.\n\n` +
          `💡 Se acredita que isso é um erro, entre em contato com o suporte.`
        );

      case 'rate_limit_minute':
        return (
          `⚠️ *Limite de mensagens atingido*\n\n` +
          `Você pode enviar até ${this.limits.perMinute} mensagens por minuto.\n\n` +
          `⏳ Aguarde ${retryAfter} segundos e tente novamente.`
        );

      case 'rate_limit_hour':
        return (
          `⚠️ *Limite de mensagens atingido*\n\n` +
          `Você pode enviar até ${this.limits.perHour} mensagens por hora.\n\n` +
          `⏳ Aguarde ${minutes} minutos e tente novamente.`
        );

      case 'rate_limit_day':
        return (
          `⚠️ *Limite diário atingido*\n\n` +
          `Você pode enviar até ${this.limits.perDay} mensagens por dia.\n\n` +
          `⏳ Aguarde ${hours} horas para continuar.\n\n` +
          `💡 Este limite protege o sistema e garante qualidade para todos.`
        );

      default:
        return '⚠️ *Limite de uso atingido*\n\nPor favor, aguarde alguns momentos antes de continuar.';
    }
  }
}
