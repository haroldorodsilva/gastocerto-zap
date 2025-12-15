import { registerAs } from '@nestjs/config';

export const baileysConfig = registerAs('baileys', () => ({
  qrTimeoutMs: parseInt(process.env.QR_TIMEOUT_MS || '120000'),
  maxReconnectAttempts: parseInt(process.env.MAX_RECONNECT_ATTEMPTS || '5'),
  reconnectIntervalMs: parseInt(process.env.RECONNECT_INTERVAL_MS || '10000'),
  printQRInTerminal: process.env.NODE_ENV === 'development',
}));
