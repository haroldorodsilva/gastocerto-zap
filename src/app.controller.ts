import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { PrismaService } from './core/database/prisma.service';
import { RedisService } from './common/services/redis.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health')
  async healthCheck() {
    const checks = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'gastocerto-zap',
      database: 'unknown',
      redis: 'unknown',
    };

    try {
      // Verifica conexão com o banco de dados
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = 'connected';
    } catch (error) {
      checks.database = 'disconnected';
      checks.status = 'degraded';
    }

    try {
      // Verifica conexão com o Redis
      const redis = this.redisService.getClient();
      await redis.ping();
      checks.redis = 'connected';
    } catch (error) {
      checks.redis = 'disconnected';
      checks.status = 'degraded';
    }

    return checks;
  }

  @Get('ping')
  ping() {
    return {
      message: 'pong',
      timestamp: new Date().toISOString(),
      env: process.env.NODE_ENV,
    };
  }
}
