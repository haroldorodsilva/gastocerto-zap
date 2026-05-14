import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Redis Service (Singleton)
 * Gerencia uma única conexão Redis para toda a aplicação
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private isConnected = false;
  private isShuttingDown = false;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    await this.connect();
  }

  async onModuleDestroy() {
    await this.disconnect();
  }

  private async connect(): Promise<void> {
    try {
      const redisUrl = this.configService.get<string>('REDIS_URL');
      const redisHost = this.configService.get<string>('REDIS_HOST', 'localhost');
      const redisPort = this.configService.get<number>('REDIS_PORT', 6379);
      const redisPassword = this.configService.get<string>('REDIS_PASSWORD');

      const envPrefix = this.configService.get<string>('REDIS_KEY_PREFIX') ?? this.configService.get<string>('NODE_ENV') ?? 'dev';
      const keyPrefix = envPrefix ? `${envPrefix}:` : '';
      if (keyPrefix) {
        this.logger.log(`🔑 Redis: usando prefixo de ambiente "${keyPrefix}"`);
      }

      const commonOptions = {
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        lazyConnect: false,
        ...(keyPrefix ? { keyPrefix } : {}),
        retryStrategy: (times: number) => {
          if (times > 10) {
            this.logger.error(`❌ Redis: desistindo após ${times} tentativas`);
            return null; // Para de reconectar (não crasha o app)
          }
          const delay = Math.min(times * 500, 5000);
          this.logger.warn(`⚠️  Redis: reconectando em ${delay}ms (tentativa ${times})`);
          return delay;
        },
      };

      if (redisUrl) {
        this.logger.log(`🔗 Conectando ao Redis via URL...`);
        this.client = new Redis(redisUrl, commonOptions);
      } else {
        this.logger.log(`🔗 Conectando ao Redis em ${redisHost}:${redisPort}...`);
        this.client = new Redis({
          host: redisHost,
          port: redisPort,
          password: redisPassword,
          ...commonOptions,
        });
      }

      this.client.on('connect', () => {
        this.isConnected = true;
        this.logger.log(`✅ Redis conectado com sucesso`);
      });

      this.client.on('error', (error) => {
        // Ignorar erros durante shutdown
        if (this.isShuttingDown) return;
        this.isConnected = false;
        this.logger.error(`❌ Redis erro: ${error.message}`);
      });

      this.client.on('close', () => {
        this.isConnected = false;
        // Não logar durante shutdown para evitar mensagens duplicadas
        if (!this.isShuttingDown) {
          this.logger.warn(`⚠️  Redis desconectado`);
        }
      });

      // Aguardar conexão
      await this.client.ping();
      this.logger.log(`✅ Redis pronto para uso`);
    } catch (error) {
      this.logger.error(`❌ Falha ao conectar Redis: ${error.message}`);
      this.client = null;
      this.isConnected = false;
    }
  }

  async disconnect(): Promise<void> {
    // Evitar múltiplas desconexões
    if (this.isShuttingDown || !this.client) {
      return;
    }

    try {
      this.isShuttingDown = true;
      this.isConnected = false;

      // Usar quit() para graceful shutdown
      await this.client.quit();
      this.logger.log('✅ Redis desconectado com sucesso');
    } catch (error) {
      // Se quit() falhar, usar disconnect() como fallback
      if (this.client && this.client.status !== 'end') {
        this.client.disconnect();
      }
      this.logger.warn('⚠️  Redis desconectado com fallback');
    } finally {
      this.client = null;
      this.isShuttingDown = false;
    }
  }

  /**
   * Retorna o cliente Redis
   * @throws Error se não estiver conectado
   */
  getClient(): Redis {
    if (!this.client || !this.isConnected) {
      throw new Error('Redis não está conectado');
    }
    return this.client;
  }

  /**
   * Verifica se está conectado
   */
  isReady(): boolean {
    return this.isConnected && this.client !== null;
  }

  /**
   * Tenta reconectar se desconectado
   */
  async ensureConnection(): Promise<boolean> {
    if (this.isReady()) {
      return true;
    }

    try {
      await this.connect();
      return this.isReady();
    } catch {
      return false;
    }
  }
}
