import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './core/database/prisma.module';
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
import { MultiPlatformSessionModule } from './infrastructure/sessions/multi-platform-session.module';
import { SessionsModule } from './infrastructure/sessions/sessions.module';
import { MessagesModule } from './infrastructure/messaging/messages/messages.module';
import { UsersModule } from './features/users/users.module';
import { OnboardingModule } from './features/onboarding/onboarding.module';
import { AiModule } from './infrastructure/ai/ai.module';
import { TransactionsModule } from './features/transactions/transactions.module';
import { AdminModule } from '@features/admin/admin.module';
import { WebChatModule } from '@features/webchat/webchat.module';
// import { MediaModule } from './infrastructure/media/media.module'; // TODO: Fase 5
// import { SubscriptionsModule } from './features/subscriptions/subscriptions.module'; // TODO: Futuro

@Module({
  imports: [
    // Database - PrismaModule @Global (uma única instância para toda a app)
    PrismaModule,

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
    AiModule,
    TransactionsModule,
    AdminModule,
    WebChatModule, // Chat web para frontend
    // MediaModule, // TODO: Fase 5
    // SubscriptionsModule, // TODO: Futuro
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
