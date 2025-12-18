import { Module, Global } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import { redisStore } from 'cache-manager-redis-yet';
import { GastoCertoApiService } from './gasto-certo-api.service';
import { DiscordNotificationService } from '@common/services/discord-notification.service';

/**
 * SharedModule
 *
 * Módulo global para serviços compartilhados entre outros módulos.
 * Services aqui são exportados e podem ser injetados em qualquer módulo
 * sem necessidade de importar explicitamente.
 *
 * Inclui:
 * - GastoCertoApiService: Cliente HTTP para API externa
 * - DiscordNotificationService: Notificações de erros críticos
 * - Redis/Cache: Cache distribuído global (única conexão)
 */
@Global()
@Module({
  imports: [
    HttpModule,
    ConfigModule,
    // Redis global - conexão única compartilhada
    CacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const redisUrl = configService.get<string>('REDIS_URL');
        
        if (redisUrl) {
          // Usar URL completa (para Upstash, Redis Cloud, etc)
          return {
            store: await redisStore({
              url: redisUrl,
            }),
          };
        }
        
        // Fallback para host/port separados
        const redisConfig = configService.get('redis');
        return {
          store: await redisStore({
            socket: {
              host: redisConfig.host,
              port: redisConfig.port,
            },
            password: redisConfig.password,
            ttl: redisConfig.ttl,
          }),
        };
      },
    }),
  ],
  providers: [GastoCertoApiService, DiscordNotificationService],
  exports: [GastoCertoApiService, DiscordNotificationService, CacheModule],
})
export class SharedModule {}
