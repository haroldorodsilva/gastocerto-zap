import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';
import { CorrelationIdInterceptor } from './common/interceptors/correlation-id.interceptor';
import { ErrorResponseInterceptor } from './common/interceptors/error-response.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

/**
 * Resolve a lista de origens CORS permitidas a partir de CORS_ORIGINS (env).
 * Aceita lista separada por vírgula. Fallback: '*' em dev, nenhum em prod.
 */
function resolveCorsOrigins(configService: ConfigService): string | string[] {
  const raw = configService.get<string>('CORS_ORIGINS');
  if (raw) {
    return raw.split(',').map((o) => o.trim());
  }
  const env = configService.get('NODE_ENV', 'development');
  return env === 'production' ? [] : '*';
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Global error handlers — evita crash por erros não capturados (ex: Redis limit exceeded)
  process.on('unhandledRejection', (reason) => {
    logger.error(`Unhandled Rejection: ${reason}`);
  });
  process.on('uncaughtException', (error) => {
    logger.error(`Uncaught Exception: ${error.message}`, error.stack);
    // Só mata o processo se for erro fatal (não Redis/rede)
    if (error.message?.includes('FATAL') || error.message?.includes('out of memory')) {
      process.exit(1);
    }
  });

  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug', 'verbose'],
  });

  const configService = app.get(ConfigService);
  const port = configService.get('PORT', 3000);
  const nodeEnv = configService.get('NODE_ENV', 'development');

  // 🔒 Security headers (helmet)
  app.use(helmet());

  // 📦 Gzip compression
  app.use(compression());

  // 🔗 Correlation ID para rastreabilidade
  app.useGlobalInterceptors(new CorrelationIdInterceptor());

  // 🗺️ Rota no retorno de erros de controller (success: false → adiciona route)
  app.useGlobalInterceptors(new ErrorResponseInterceptor());

  // 🛡️ Filtro global de exceções (respostas padronizadas, sem stack trace)
  app.useGlobalFilters(new AllExceptionsFilter());

  // �🔥 HABILITAR GRACEFUL SHUTDOWN
  // enableShutdownHooks() já registra os listeners de SIGTERM/SIGINT internamente
  app.enableShutdownHooks();

  // WebSocket adapter
  app.useWebSocketAdapter(new IoAdapter(app));

  // Validation pipe global
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // CORS — whitelist via env CORS_ORIGINS
  const corsOrigins = resolveCorsOrigins(configService);
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  await app.listen(port, '0.0.0.0');

  logger.log(`🚀 GastoCerto-ZAP running on port ${port}`);
  logger.log(`📊 Environment: ${nodeEnv}`);
  logger.log(`🔗 API: http://localhost:${port}`);
  logger.log(`🌐 WebSocket: ws://localhost:${port}/ws`);
  logger.log(`🔒 CORS origins: ${JSON.stringify(corsOrigins)}`);
  logger.log('\n✅ WhatsApp será inicializado automaticamente pelo WhatsAppIntegrationService\n');
}

bootstrap();
