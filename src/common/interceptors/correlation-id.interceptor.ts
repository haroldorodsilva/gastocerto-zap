import { Injectable, NestInterceptor, ExecutionContext, CallHandler, Logger } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { randomUUID } from 'crypto';

const CORRELATION_HEADER = 'x-correlation-id';

/**
 * Interceptor que injeta um Correlation ID em cada requisição HTTP.
 *
 * - Se o client enviar `x-correlation-id`, ele é preservado.
 * - Caso contrário, um UUID v4 é gerado automaticamente.
 * - O ID é adicionado ao header de resposta para rastreabilidade.
 * - Tempo de resposta é logado junto com o correlationId.
 */
@Injectable()
export class CorrelationIdInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest();
    const response = ctx.getResponse();

    // Preservar ou gerar correlation ID
    const correlationId = request.headers?.[CORRELATION_HEADER] || randomUUID();
    request.correlationId = correlationId;

    // Adicionar ao header de resposta
    response?.setHeader?.(CORRELATION_HEADER, correlationId);

    const method = request.method;
    const url = request.url;
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const elapsed = Date.now() - start;
          this.logger.log(
            `${method} ${url} ${response.statusCode} ${elapsed}ms [${correlationId}]`,
          );
        },
        error: (err) => {
          const elapsed = Date.now() - start;
          this.logger.error(
            `${method} ${url} ${err.status || 500} ${elapsed}ms [${correlationId}] ${err.message}`,
          );
        },
      }),
    );
  }
}
