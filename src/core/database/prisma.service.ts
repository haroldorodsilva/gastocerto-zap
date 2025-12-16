import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * PrismaService - Serviço singleton para gerenciar conexão com o banco de dados.
 * 
 * ⚠️ IMPORTANTE: Este serviço é @Global (via PrismaModule) e deve ser instanciado
 * apenas UMA VEZ em toda a aplicação. Não adicione PrismaService nos providers
 * de outros módulos - o PrismaModule já exporta e disponibiliza globalmente.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private static isConnected = false;

  constructor() {
    super({
      log: ['error', 'warn'],
    });
  }

  async onModuleInit() {
    // Evita múltiplas conexões ao banco (conexão única/singleton)
    if (PrismaService.isConnected) {
      return;
    }

    try {
      await this.$connect();
      PrismaService.isConnected = true;
      this.logger.log('✅ Database connected successfully (singleton connection)');
    } catch (error) {
      this.logger.error('❌ Failed to connect to database', error);
      throw error;
    }
  }

  async onModuleDestroy() {
    if (PrismaService.isConnected) {
      await this.$disconnect();
      PrismaService.isConnected = false;
      this.logger.log('🔌 Database disconnected');
    }
  }
}
