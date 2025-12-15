import { registerAs } from '@nestjs/config';

export const gastoCertoApiConfig = registerAs('gastoCertoApi', () => ({
  baseUrl: process.env.GASTO_CERTO_API_URL || 'https://api.gastocerto.com.br',
  timeout: parseInt(process.env.API_TIMEOUT || '30000'),
}));
