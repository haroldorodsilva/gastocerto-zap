import { registerAs } from '@nestjs/config';

export const databaseConfig = registerAs('database', () => ({
  url: process.env.DATABASE_URL,
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '50'),
  poolTimeout: parseInt(process.env.DB_POOL_TIMEOUT || '10'),
}));
