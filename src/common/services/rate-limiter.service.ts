import { Injectable, Logger } from '@nestjs/common';
import { AIProviderType } from '../../infrastructure/ai/ai.interface';
import { PrismaService } from '../../core/database/prisma.service';
import { RedisService } from './redis.service';

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
 *
 * ⚠️  Rate limits agora vêm do banco (AIProviderConfig)
 */
@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);
  private readonly limits = new Map<AIProviderType, RateLimit>();
  private initialized = false;

  constructor(
    private readonly redisService: RedisService,
    private readonly prisma: PrismaService,
  ) {
    // Carregar limites do banco
    this.loadLimits();
  }

  /**
   * Carrega limites de rate limit do banco de dados (AIProviderConfig)
   */
  private async loadLimits(): Promise<void> {
    if (this.initialized) return;

    try {
      const providers = await this.prisma.aIProviderConfig.findMany({
        where: { enabled: true },
      });

      for (const provider of providers) {
        const providerType = this.mapProviderToType(provider.provider);
        if (providerType) {
          this.limits.set(providerType, {
            rpm: provider.rpmLimit || 0, // 0 = ilimitado
            tpm: provider.tpmLimit || 0,
          });
        }
      }

      if (this.limits.size > 0) {
        this.logger.log('📊 Rate limits carregados do BANCO:');
        this.limits.forEach((limit, provider) => {
          const rpmStr = limit.rpm === 0 ? 'ilimitado' : `${limit.rpm} RPM`;
          const tpmStr = limit.tpm === 0 ? 'ilimitado' : `${limit.tpm} TPM`;
          this.logger.log(`   ${provider}: ${rpmStr}, ${tpmStr}`);
        });
      } else {
        this.logger.warn('⚠️  Nenhum rate limit configurado no banco');
      }

      this.initialized = true;
    } catch (error) {
      this.logger.error('Erro ao carregar rate limits do banco:', error);
      this.initialized = true; // Marca como inicializado mesmo com erro
    }
  }

  /**
   * Mapeia string do provider para AIProviderType enum
   */
  private mapProviderToType(provider: string): AIProviderType | null {
    const mapping: Record<string, AIProviderType> = {
      openai: AIProviderType.OPENAI,
      google_gemini: AIProviderType.GOOGLE_GEMINI,
      groq: AIProviderType.GROQ,
      deepseek: AIProviderType.DEEPSEEK,
    };
    return mapping[provider] || null;
  }

  /**
   * Garante que configurações foram carregadas
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.loadLimits();
    }
  }

  /**
   * Verifica se pode fazer request ao provider
   */
  async checkLimit(provider: AIProviderType, estimatedTokens: number = 500): Promise<boolean> {
    await this.ensureInitialized();

    const limit = this.limits.get(provider);
    if (!limit) {
      this.logger.warn(`Rate limit não configurado para provider: ${provider}`);
      return true; // Permite se não houver limite configurado
    }

    // Se RPM/TPM = 0, significa ilimitado
    if (limit.rpm === 0 && limit.tpm === 0) {
      return true;
    }

    const usage = await this.getUsage(provider);

    // Verifica RPM (se configurado)
    if (limit.rpm > 0 && usage.rpm >= limit.rpm) {
      this.logger.warn(`⚠️  Rate limit RPM excedido para ${provider}: ${usage.rpm}/${limit.rpm}`);
      return false;
    }

    // Verifica TPM (se configurado)
    if (limit.tpm > 0 && usage.tpm + estimatedTokens > limit.tpm) {
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
    await this.redisService.getClient().incr(rpmKey);
    await this.redisService.getClient().expire(rpmKey, 120);

    await this.redisService.getClient().incrby(tpmKey, tokensUsed);
    await this.redisService.getClient().expire(tpmKey, 120);
  }

  /**
   * Obtém uso atual do provider
   */
  async getUsage(provider: AIProviderType): Promise<UsageStats> {
    const now = Date.now();
    const minuteKey = Math.floor(now / 60000);

    const rpmKey = `ratelimit:${provider}:rpm:${minuteKey}`;
    const tpmKey = `ratelimit:${provider}:tpm:${minuteKey}`;

    const [rpm, tpm] = await Promise.all([
      this.redisService.getClient().get(rpmKey),
      this.redisService.getClient().get(tpmKey),
    ]);

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
      await this.redisService.getClient().del(rpmKey, tpmKey);
    } else {
      // Reseta todos
      const keys = await this.redisService.getClient().keys('ratelimit:*');
      if (keys.length > 0) {
        await this.redisService.getClient().del(...keys);
      }
    }

    this.logger.log(`🔄 Rate limit counters resetados${provider ? ` para ${provider}` : ''}`);
  }
}
