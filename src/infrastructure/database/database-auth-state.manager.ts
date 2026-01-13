import { Logger } from '@nestjs/common';
import { PrismaService } from '@core/database/prisma.service';
import { AuthenticationState } from '@whiskeysockets/baileys';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Database Auth State Manager
 *
 * Gerencia o estado de autenticação do Baileys usando o banco de dados
 * ao invés de arquivos locais. Isso permite:
 * - Reconexão automática após reiniciar o servidor
 * - Backup das credenciais
 * - Portabilidade entre servidores
 */
export class DatabaseAuthStateManager {
  private readonly logger = new Logger(DatabaseAuthStateManager.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionId: string,
  ) {}

  /**
   * Usa o estado do banco de dados para autenticação
   */
  async useDatabaseAuthState(): Promise<{
    state: AuthenticationState;
    saveCreds: () => Promise<void>;
  }> {
    // Buscar credenciais do banco
    const session = await this.prisma.whatsAppSession.findUnique({
      where: { sessionId: this.sessionId },
    });

    let creds: any = session?.creds as any;

    // Se não houver credenciais, criar novas
    if (!creds) {
      creds = {
        noiseKey: undefined,
        pairingEphemeralKeyPair: undefined,
        signedIdentityKey: undefined,
        signedPreKey: undefined,
        registrationId: undefined,
        advSecretKey: undefined,
        processedHistoryMessages: [],
        nextPreKeyId: 0,
        firstUnuploadedPreKeyId: 0,
        accountSyncCounter: 0,
        accountSettings: undefined,
      };
    }

    const state: AuthenticationState = {
      creds,
      keys: {
        get: async () => {
          const data: { [id: string]: any } = {};

          // Por enquanto, retornar vazio - keys são efêmeras e podem ser regeneradas
          // Em produção, você pode querer armazenar isso também
          return data;
        },
        set: async () => {
          // Keys são armazenadas localmente e podem ser regeneradas
          // Não precisamos persistir no banco
        },
      },
    };

    const saveCreds = async () => {
      try {
        await this.prisma.whatsAppSession.update({
          where: { sessionId: this.sessionId },
          data: {
            creds: state.creds as any,
            updatedAt: new Date(),
          },
        });
        this.logger.debug(`✅ Credentials saved for session: ${this.sessionId}`);
      } catch (error) {
        this.logger.error(`❌ Error saving credentials: ${error.message}`);
      }
    };

    return { state, saveCreds };
  }

  /**
   * Migra credenciais de arquivo para banco de dados
   */
  async migrateFromFile(authDir: string): Promise<boolean> {
    try {
      const credsPath = path.join(authDir, 'creds.json');

      if (!fs.existsSync(credsPath)) {
        this.logger.debug(`No file credentials found at ${credsPath}`);
        return false;
      }

      const creds = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));

      await this.prisma.whatsAppSession.update({
        where: { sessionId: this.sessionId },
        data: {
          creds: creds,
          updatedAt: new Date(),
        },
      });

      this.logger.log(
        `✅ Migrated credentials from file to database for session: ${this.sessionId}`,
      );

      // Opcional: Remover arquivos após migração bem-sucedida
      // fs.rmSync(authDir, { recursive: true, force: true });

      return true;
    } catch (error) {
      this.logger.error(`❌ Error migrating credentials: ${error.message}`);
      return false;
    }
  }

  /**
   * Limpa credenciais do banco
   */
  async clearCreds(): Promise<void> {
    try {
      await this.prisma.whatsAppSession.update({
        where: { sessionId: this.sessionId },
        data: {
          creds: null,
          updatedAt: new Date(),
        },
      });
      this.logger.log(`🗑️  Credentials cleared for session: ${this.sessionId}`);
    } catch (error) {
      this.logger.error(`❌ Error clearing credentials: ${error.message}`);
    }
  }

  /**
   * Verifica se há credenciais salvas
   */
  async hasCreds(): Promise<boolean> {
    const session = await this.prisma.whatsAppSession.findUnique({
      where: { sessionId: this.sessionId },
      select: { creds: true },
    });

    return session?.creds !== null && session?.creds !== undefined;
  }
}
