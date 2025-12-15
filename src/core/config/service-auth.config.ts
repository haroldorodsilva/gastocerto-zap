import { registerAs } from '@nestjs/config';

export const serviceAuthConfig = registerAs('serviceAuth', () => ({
  // Secret compartilhado entre os serviços (nunca commitar no git)
  sharedSecret: process.env.SERVICE_SHARED_SECRET || 'changeme-in-production',

  // Timeout de requisição (5 minutos)
  requestTimeoutMs: parseInt(process.env.SERVICE_REQUEST_TIMEOUT_MS || '300000'),

  // Identidades dos serviços
  thisServiceId: process.env.GASTOCERTO_ZAP_SERVICE_ID || 'gastocerto-zap',
  gastoCertoApiId: process.env.GASTOCERTO_CERTO_API_SERVICE_ID || 'gastocerto-api',
}));
