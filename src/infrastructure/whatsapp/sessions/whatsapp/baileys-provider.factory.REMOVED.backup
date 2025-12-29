import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BaileysWhatsAppProvider } from './baileys-whatsapp.provider';
import { DatabaseAuthStateManager } from './database-auth-state.manager';

/**
 * Factory para criar instâncias de BaileysWhatsAppProvider
 * Segue padrão de DI do NestJS e evita instanciação múltipla
 */
@Injectable()
export class BaileysProviderFactory {
  private readonly logger = new Logger(BaileysProviderFactory.name);

  constructor(
    private readonly config: ConfigService,
    private readonly authStateManager: DatabaseAuthStateManager,
  ) {
    this.logger.log('BaileysProviderFactory inicializado');
  }

  /**
   * Cria nova instância de BaileysWhatsAppProvider para uma sessão
   * @param sessionId ID da sessão
   * @returns Instância configurada do provider
   */
  async create(sessionId: string): Promise<BaileysWhatsAppProvider> {
    this.logger.log(`Criando provider para sessão: ${sessionId}`);

    try {
      // Criar provider com configurações injetadas
      // NOTA: authState será passado via initialize(), não no construtor
      const provider = new BaileysWhatsAppProvider(
        this.config,
        undefined, // authState será passado depois
        sessionId
      );

      this.logger.log(`Provider criado com sucesso para sessão: ${sessionId}`);

      return provider;
    } catch (error) {
      this.logger.error(
        `Erro ao criar provider para sessão ${sessionId}:`,
        error.stack
      );
      throw error;
    }
  }

  /**
   * Valida se uma sessão pode ter um provider criado
   * @param sessionId ID da sessão
   * @returns true se pode criar, false caso contrário
   */
  async canCreate(sessionId: string): Promise<boolean> {
    try {
      const hasAuth = await this.authStateManager.hasAuthState(sessionId);
      const isValid = await this.authStateManager.validateAuthIntegrity(sessionId);

      this.logger.debug(`Validação de criação para sessão ${sessionId}`, {
        hasAuth,
        isValid,
        canCreate: hasAuth && isValid
      });

      return hasAuth && isValid;
    } catch (error) {
      this.logger.error(
        `Erro ao validar criação para sessão ${sessionId}:`,
        error.stack
      );
      return false;
    }
  }
}
