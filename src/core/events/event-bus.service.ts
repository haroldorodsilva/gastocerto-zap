import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventType } from './events.constants';

/**
 * Event Bus centralizado do sistema
 * Encapsula EventEmitter2 com type safety e logging
 */
@Injectable()
export class EventBusService {
  private readonly logger = new Logger(EventBusService.name);

  constructor(private eventEmitter: EventEmitter2) {}

  /**
   * Emite evento com payload
   */
  emit<T = any>(event: EventType, payload: T): void {
    this.logger.debug(`📡 Event emitted: ${event}`, {
      event,
      payload: this.sanitizePayload(payload),
    });

    this.eventEmitter.emit(event, payload);
  }

  /**
   * Escuta evento (para uso interno nos módulos)
   */
  on<T = any>(event: EventType, listener: (payload: T) => void): void {
    this.eventEmitter.on(event, listener);
  }

  /**
   * Escuta evento apenas uma vez
   */
  once<T = any>(event: EventType, listener: (payload: T) => void): void {
    this.eventEmitter.once(event, listener);
  }

  /**
   * Remove listener
   */
  off<T = any>(event: EventType, listener: (payload: T) => void): void {
    this.eventEmitter.off(event, listener);
  }

  /**
   * Emite evento e aguarda todos os listeners (para testes)
   */
  async emitAsync<T = any>(event: EventType, payload: T): Promise<void> {
    this.logger.debug(`📡 Event emitted (async): ${event}`, {
      event,
      payload: this.sanitizePayload(payload),
    });

    await this.eventEmitter.emitAsync(event, payload);
  }

  /**
   * Remove dados sensíveis do log
   */
  private sanitizePayload(payload: any): any {
    if (!payload) return payload;

    const sanitized = { ...payload };

    // Remover campos sensíveis
    const sensitiveFields = ['password', 'token', 'apiKey', 'secret'];
    for (const field of sensitiveFields) {
      if (field in sanitized) {
        sanitized[field] = '[REDACTED]';
      }
    }

    return sanitized;
  }

  /**
   * Lista todos os eventos registrados (debug)
   */
  getEventNames(): string[] {
    return this.eventEmitter.eventNames() as string[];
  }

  /**
   * Retorna quantidade de listeners para um evento
   */
  listenerCount(event: EventType): number {
    return this.eventEmitter.listenerCount(event);
  }
}
