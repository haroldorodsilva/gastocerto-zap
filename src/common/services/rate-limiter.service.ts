import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AIProviderType } from '../../infrastructure/ai/ai.interface';

interface RateLimit {
  rpm: number; // Requests per minute
  tpm: number; // Tokens per minute
}

interface UsageStats {
  rpm: number;
  tpm: number;
  resetAt: Date;
}

/**
 * Rate Limiter Service
 * Controla limites de requisições por provider AI
 */
@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);
  private readonly redis: Redis;

  // Limites padrão por provider (configuráveis via ENV)
  private readonly limits = new Map<AIProviderType, RateLimit>();

  constructor(private readonly configService: ConfigService) {
    // Inicializar Redis
    const redisUrl = this.configService.get<string>('REDIS_URL');
    const redisHost = this.configService.get<string>('REDIS_HOST', 'localhost');
    const redisPort = this.configService.get<number>('REDIS_PORT', 6379);

    if (redisUrl) {
      this.redis = new Redis(redisUrl);
    } else {
      this.redis = new Redis({
        host: redisHost,
        port: redisPort,
      });
    }

    // Carregar limites (com fallback para valores padrão)
    this.loadLimits();

    this.logger.log('✅ RateLimiterService inicializado');
  }

  /**
   * Carrega limites de rate limit por provider
   */
  private loadLimits(): void {
    // OpenAI: https://platform.openai.com/docs/guides/rate-limits
    this.limits.set(AIProviderType.OPENAI, {
      rpm: this.configService.get<number>('OPENAI_RATE_LIMIT_RPM', 500),
      tpm: this.configService.get<number>('OPENAI_RATE_LIMIT_TPM', 90000),
    });

    // Google Gemini: https://ai.google.dev/pricing
    this.limits.set(AIProviderType.GOOGLE_GEMINI, {
      rpm: this.configService.get<number>('GEMINI_RATE_LIMIT_RPM', 60),
      tpm: this.configService.get<number>('GEMINI_RATE_LIMIT_TPM', 30000),
    });

    // Groq: https://console.groq.com/docs/rate-limits
    this.limits.set(AIProviderType.GROQ, {
      rpm: this.configService.get<number>('GROQ_RATE_LIMIT_RPM', 30),
      tpm: this.configService.get<number>('GROQ_RATE_LIMIT_TPM', 15000),
    });

    this.logger.log('📊 Rate limits carregados:');
    this.limits.forEach((limit, provider) => {
      this.logger.log(`   ${provider}: ${limit.rpm} RPM, ${limit.tpm} TPM`);
    });
  }

  /**
   * Verifica se pode fazer request ao provider
   */
  async checkLimit(provider: AIProviderType, estimatedTokens: number = 500): Promise<boolean> {
    const limit = this.limits.get(provider);
    if (!limit) {
      this.logger.warn(`Rate limit não configurado para provider: ${provider}`);
      return true; // Permite se não houver limite configurado
    }

    const usage = await this.getUsage(provider);

    // Verifica se excedeu RPM
    if (usage.rpm >= limit.rpm) {
      this.logger.warn(`⚠️  Rate limit RPM excedido para ${provider}: ${usage.rpm}/${limit.rpm}`);
      return false;
    }

    // Verifica se vai exceder TPM com essa requisição
    if (usage.tpm + estimatedTokens > limit.tpm) {
      this.logger.warn(
        `⚠️  Rate limit TPM excedido para ${provider}: ${usage.tpm + estimatedTokens}/${limit.tpm}`,
      );
      return false;
    }

    return true;
  }

  /**
   * Registra uso de request
   */
  async recordUsage(provider: AIProviderType, tokensUsed: number): Promise<void> {
    const now = Date.now();
    const minuteKey = Math.floor(now / 60000); // Minuto atual

    const rpmKey = `ratelimit:${provider}:rpm:${minuteKey}`;
    const tpmKey = `ratelimit:${provider}:tpm:${minuteKey}`;

    // Incrementa contadores com TTL de 2 minutos
    await this.redis.incr(rpmKey);
    await this.redis.expire(rpmKey, 120);

    await this.redis.incrby(tpmKey, tokensUsed);
    await this.redis.expire(tpmKey, 120);
  }

  /**
   * Obtém uso atual do provider
   */
  async getUsage(provider: AIProviderType): Promise<UsageStats> {
    const now = Date.now();
    const minuteKey = Math.floor(now / 60000);

    const rpmKey = `ratelimit:${provider}:rpm:${minuteKey}`;
    const tpmKey = `ratelimit:${provider}:tpm:${minuteKey}`;

    const [rpm, tpm] = await Promise.all([this.redis.get(rpmKey), this.redis.get(tpmKey)]);

    const nextMinute = (minuteKey + 1) * 60000;
    const resetAt = new Date(nextMinute);

    return {
      rpm: parseInt(rpm || '0', 10),
      tpm: parseInt(tpm || '0', 10),
      resetAt,
    };
  }

  /**
   * Aguarda até que o rate limit seja resetado
   */
  async waitForReset(provider: AIProviderType): Promise<void> {
    const usage = await this.getUsage(provider);
    const waitMs = usage.resetAt.getTime() - Date.now();

    if (waitMs > 0) {
      this.logger.log(
        `⏳ Aguardando ${Math.ceil(waitMs / 1000)}s para reset do rate limit de ${provider}`,
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  /**
   * Obtém estatísticas de todos os providers
   */
  async getAllStats(): Promise<Record<string, UsageStats>> {
    const stats: Record<string, UsageStats> = {};

    for (const provider of this.limits.keys()) {
      stats[provider] = await this.getUsage(provider);
    }

    return stats;
  }

  /**
   * Reseta contadores (útil para testes)
   */
  async resetCounters(provider?: AIProviderType): Promise<void> {
    const now = Date.now();
    const minuteKey = Math.floor(now / 60000);

    if (provider) {
      const rpmKey = `ratelimit:${provider}:rpm:${minuteKey}`;
      const tpmKey = `ratelimit:${provider}:tpm:${minuteKey}`;
      await this.redis.del(rpmKey, tpmKey);
    } else {
      // Reseta todos
      const keys = await this.redis.keys('ratelimit:*');
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    }

    this.logger.log(`🔄 Rate limit counters resetados${provider ? ` para ${provider}` : ''}`);
  }
}
