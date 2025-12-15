import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './core/database/prisma.service';
import { databaseConfig } from './core/config/database.config';
import { redisConfig } from './core/config/redis.config';
import { baileysConfig } from './core/config/baileys.config';
import { aiConfig } from './core/config/ai.config';
import { gastoCertoApiConfig } from './core/config/gasto-certo-api.config';
import { serviceAuthConfig } from './core/config/service-auth.config';

// Importar módulos
import { CommonModule } from './common/common.module';
import { SharedModule } from '@shared/shared.module';
import { EventsModule } from './core/events/events.module'; // ← Event Bus
import { SecurityModule } from './features/security/security.module'; // ← Segurança
import { AssistantModule } from './features/assistant/assistant.module'; // ← Assistente
import { MultiPlatformSessionModule } from './infrastructure/whatsapp/sessions/multi-platform-session.module';
import { SessionsModule } from './infrastructure/whatsapp/sessions/sessions.module';
import { MessagesModule } from './infrastructure/whatsapp/messages/messages.module';
import { UsersModule } from './features/users/users.module';
import { OnboardingModule } from './features/onboarding/onboarding.module';
import { AiModule } from './infrastructure/ai/ai.module';
import { TransactionsModule } from './features/transactions/transactions.module';
import { AdminModule } from '@features/admin/admin.module';
// import { MediaModule } from './infrastructure/media/media.module'; // TODO: Fase 5
// import { SubscriptionsModule } from './features/subscriptions/subscriptions.module'; // TODO: Futuro

@Module({
  imports: [
    // Configuração global
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        databaseConfig,
        redisConfig,
        baileysConfig,
        aiConfig,
        gastoCertoApiConfig,
        serviceAuthConfig,
      ],
      envFilePath: '.env',
    }),

    // Event Emitter para comunicação entre módulos
    EventEmitterModule.forRoot({
      wildcard: true,
      delimiter: '.',
      maxListeners: 20,
    }),

    // Schedule Module para cron jobs
    ScheduleModule.forRoot(),

    // Bull (Redis queues)
    BullModule.forRootAsync({
      useFactory: () => ({
        redis: {
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379'),
          password: process.env.REDIS_PASSWORD,
        },
      }),
    }),

    // Módulos da aplicação
    EventsModule, // Event Bus @Global
    SecurityModule, // Segurança (PRIMEIRO)
    CommonModule,
    SharedModule,
    MultiPlatformSessionModule, // @Global - Deve ser carregado ANTES de SessionsModule
    SessionsModule,
    MessagesModule,
    UsersModule,
    OnboardingModule,
    AssistantModule, // Assistente conversacional
    AiModule,
    TransactionsModule,
    AdminModule,
    // MediaModule, // TODO: Fase 5
    // SubscriptionsModule, // TODO: Futuro
  ],
  controllers: [AppController],
  providers: [AppService, PrismaService],
})
export class AppModule {}
