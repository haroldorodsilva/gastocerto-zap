import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@core/database/prisma.service';
import { BufferJSON, initAuthCreds } from '@whiskeysockets/baileys';

export interface WhatsAppAuthState {
  creds: any;
  keys: Record<string, any>;
}

/**
 * Database-backed authentication state manager
 * Stores WhatsApp session credentials in PostgreSQL
 */
@Injectable()
export class DatabaseAuthStateManager {
  private readonly logger = new Logger(DatabaseAuthStateManager.name);
  private readonly saveTimers = new Map<string, NodeJS.Timeout>();
  private readonly DEBOUNCE_DELAY_MS = 2000; // Save at most once per 2 seconds

  constructor(private readonly prisma: PrismaService) {}

  async loadAuthState(sessionId: string): Promise<WhatsAppAuthState> {
    try {
      const session = await this.prisma.whatsAppSession.findUnique({
        where: { sessionId },
        select: { creds: true },
      });

      if (!session?.creds) {
        // Return empty state for new sessions
        return {
          creds: undefined,
          keys: {},
        };
      }

      // Deserialize stored data
      const storedData = session.creds as any;

      // Parse any Buffer data that was serialized
      const creds = storedData.creds
        ? JSON.parse(JSON.stringify(storedData.creds), BufferJSON.reviver)
        : undefined;
      const keys = storedData.keys
        ? JSON.parse(JSON.stringify(storedData.keys), BufferJSON.reviver)
        : {};

      this.logger.debug(`Loaded auth state for session ${sessionId} (has creds: ${!!creds})`);

      return {
        creds,
        keys,
      };
    } catch (error) {
      this.logger.error(`Failed to load auth state for ${sessionId}: ${error.message}`);
      return {
        creds: undefined,
        keys: {},
      };
    }
  }

  async saveAuthState(sessionId: string, authState: WhatsAppAuthState): Promise<void> {
    try {
      // Serialize data with BufferJSON to handle Uint8Array and other special types
      const serialized = JSON.stringify(
        {
          creds: authState.creds,
          keys: authState.keys,
        },
        BufferJSON.replacer,
      );

      // Parse back to ensure it's a valid JSON object for Prisma
      const parsedData = JSON.parse(serialized);

      await this.prisma.whatsAppSession.update({
        where: { sessionId },
        data: {
          creds: parsedData,
          updatedAt: new Date(),
        },
      });

      this.logger.debug(`Saved auth state for session ${sessionId}`);
    } catch (error) {
      this.logger.error(`Failed to save auth state for ${sessionId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Debounced version of saveAuthState to prevent excessive DB writes
   */
  debouncedSaveAuthState(sessionId: string, authState: WhatsAppAuthState): void {
    // Clear existing timer if any
    const existingTimer = this.saveTimers.get(sessionId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Schedule new save
    const timer = setTimeout(() => {
      this.saveAuthState(sessionId, authState).catch((error) => {
        this.logger.error(`Debounced save failed for ${sessionId}: ${error.message}`);
      });
      this.saveTimers.delete(sessionId);
    }, this.DEBOUNCE_DELAY_MS);

    this.saveTimers.set(sessionId, timer);
  }

  async clearAuthState(sessionId: string): Promise<void> {
    try {
      // Clear any pending timers
      const existingTimer = this.saveTimers.get(sessionId);
      if (existingTimer) {
        clearTimeout(existingTimer);
        this.saveTimers.delete(sessionId);
      }

      // Clear credentials from database
      await this.prisma.whatsAppSession.update({
        where: { sessionId },
        data: {
          creds: null,
          updatedAt: new Date(),
        },
      });

      this.logger.log(`✅ Cleared auth state for session ${sessionId}`);
    } catch (error) {
      this.logger.error(`Failed to clear auth state for ${sessionId}: ${error.message}`);
      throw error;
    }
  }

  async hasAuthState(sessionId: string): Promise<boolean> {
    try {
      const session = await this.prisma.whatsAppSession.findUnique({
        where: { sessionId },
        select: { creds: true },
      });

      const hasCreds = !!(
        session?.creds &&
        typeof session.creds === 'object' &&
        (session.creds as any).creds
      );

      return hasCreds;
    } catch (error) {
      this.logger.error(`Failed to check auth state for ${sessionId}: ${error.message}`);
      return false;
    }
  }

  /**
   * Valida se as credenciais estão íntegras (não corrompidas)
   */
  async validateAuthIntegrity(sessionId: string): Promise<boolean> {
    try {
      const session = await this.prisma.whatsAppSession.findUnique({
        where: { sessionId },
        select: { creds: true },
      });

      if (!session?.creds) {
        return false;
      }

      const storedData = session.creds as any;

      // Verifica se tem credenciais
      if (!storedData.creds) {
        this.logger.warn(`❌ No creds found for session ${sessionId}`);
        return false;
      }

      // Valida campos críticos que o Baileys precisa
      const creds = storedData.creds;
      const requiredFields = [
        'noiseKey',
        'signedIdentityKey',
        'signedPreKey',
        'registrationId',
        'advSecretKey',
      ];

      for (const field of requiredFields) {
        if (!creds[field]) {
          this.logger.warn(`❌ Missing required field '${field}' for session ${sessionId}`);
          return false;
        }
      }

      // Valida se noiseKey tem a propriedade 'public' que estava causando erro
      if (!creds.noiseKey.public || !creds.noiseKey.private) {
        this.logger.warn(`❌ Corrupted noiseKey for session ${sessionId}`);
        return false;
      }

      this.logger.debug(`✅ Auth state validation passed for session ${sessionId}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to validate auth integrity for ${sessionId}: ${error.message}`);
      return false;
    }
  }

  /**
   * Create a Baileys-compatible auth state object
   */
  async createBaileysAuthState(sessionId: string) {
    const authState = await this.loadAuthState(sessionId);

    // Initialize credentials if they don't exist (new session)
    if (!authState.creds) {
      this.logger.log(`Initializing new credentials for session ${sessionId}`);
      authState.creds = initAuthCreds();
      // Save the initial credentials
      await this.saveAuthState(sessionId, authState);
    }

    const keys = new Map<string, any>(Object.entries(authState.keys || {}));

    const saveCreds = async (newCreds: any) => {
      authState.creds = newCreds;
      await this.saveAuthState(sessionId, authState);
    };

    return {
      state: {
        creds: authState.creds,
        keys: {
          get: async (type: string, ids: string[]) => {
            const result: any = {};
            ids.forEach((id) => {
              const key = `${type}-${id}`;
              if (keys.has(key)) {
                result[id] = keys.get(key);
              }
            });
            return result;
          },
          set: async (data: any) => {
            for (const category in data) {
              for (const id in data[category]) {
                const key = `${category}-${id}`;
                const value = data[category][id];
                if (value) {
                  keys.set(key, value);
                  authState.keys[key] = value;
                } else {
                  keys.delete(key);
                  delete authState.keys[key];
                }
              }
            }
            // Use debounced save to prevent excessive DB writes during sync
            this.debouncedSaveAuthState(sessionId, authState);
          },
        },
      },
      saveCreds,
    };
  }
}
