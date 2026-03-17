import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Interceptor que enriquece respostas de erro geradas por try/catch nos controllers.
 *
 * Quando o body da resposta contém `success: false`, injeta automaticamente
 * o campo `route` no formato "METHOD /caminho" para facilitar o diagnóstico.
 *
 * Funciona em complemento ao AllExceptionsFilter, que já cobre exceções não capturadas.
 */
@Injectable()
export class ErrorResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest();

    return next.handle().pipe(
      map((data) => {
        if (data && typeof data === 'object' && data.success === false) {
          return {
            ...data,
            route: `${request.method} ${request.url}`,
          };
        }
        return data;
      }),
    );
  }
}
