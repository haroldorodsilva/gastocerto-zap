import { registerAs } from '@nestjs/config';

export const serviceAuthConfig = registerAs('serviceAuth', () => ({
  // Secret compartilhado entre os serviços (nunca commitar no git)
  sharedSecret: process.env.SERVICE_SHARED_SECRET || 'changeme-in-production',

  // Timeout de requisição (5 minutos)
  requestTimeoutMs: parseInt(process.env.SERVICE_REQUEST_TIMEOUT_MS || '300000'),
}));
