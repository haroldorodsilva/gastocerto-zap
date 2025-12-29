import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug', 'verbose'],
  });

  const configService = app.get(ConfigService);
  const port = configService.get('PORT', 3000);
  const nodeEnv = configService.get('NODE_ENV', 'development');

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

  // CORS (ajustar conforme necessário)
  app.enableCors({
    origin: '*',
    credentials: true,
  });

  await app.listen(port);

  logger.log(`🚀 GastoCerto-ZAP running on port ${port}`);
  logger.log(`📊 Environment: ${nodeEnv}`);
  logger.log(`🔗 API: http://localhost:${port}`);
  logger.log(`🌐 WebSocket: ws://localhost:${port}/ws`);
  logger.log('\n✅ WhatsApp será inicializado automaticamente pelo WhatsAppIntegrationService\n');
}

bootstrap();
