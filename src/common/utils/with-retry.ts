import { Logger } from '@nestjs/common';

const logger = new Logger('withRetry');

/**
 * Executa uma função com retry e backoff exponencial.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: { maxAttempts?: number; backoffMs?: number; label?: string },
): Promise<T> {
  const maxAttempts = opts?.maxAttempts ?? 3;
  const backoffMs = opts?.backoffMs ?? 2000;
  const label = opts?.label ?? 'task';

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      logger.error(`${label} failed (attempt ${attempt}/${maxAttempts}): ${error.message}`);

      if (attempt < maxAttempts) {
        const delay = backoffMs * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError;
}

/**
 * Executa fn de forma assíncrona (fire-and-forget) com retry.
 * Não bloqueia o caller. Erros são logados, não propagados.
 */
export function fireAndForget<T>(
  fn: () => Promise<T>,
  opts?: { maxAttempts?: number; backoffMs?: number; label?: string },
): void {
  setImmediate(() => {
    withRetry(fn, opts).catch((err) => {
      logger.error(`${opts?.label ?? 'task'} failed permanently: ${err.message}`);
    });
  });
}
