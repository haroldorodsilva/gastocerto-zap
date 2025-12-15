import { Module, Global } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { EventBusService } from './event-bus.service';

/**
 * Módulo global de eventos
 * Disponível em toda aplicação sem imports
 */
@Global()
@Module({
  imports: [
    EventEmitterModule.forRoot({
      // Configurações do EventEmitter
      wildcard: false,
      delimiter: '.',
      newListener: false,
      removeListener: false,
      maxListeners: 20, // Prevenir memory leaks
      verboseMemoryLeak: true,
      ignoreErrors: false,
    }),
  ],
  providers: [EventBusService],
  exports: [EventBusService],
})
export class EventsModule {}
