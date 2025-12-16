import { Injectable, Logger, Optional } from '@nestjs/common';
import { UserCacheService } from '@features/users/user-cache.service';
import { RAGService } from '@infrastructure/ai/rag/rag.service';

export interface AccountOperationResult {
  success: boolean;
  message: string;
  requiresConfirmation?: boolean;
  metadata?: any;
}

/**
 * AccountManagementService
 *
 * Serviço dedicado para gerenciamento de contas do usuário.
 * Responsável por:
 * - Listar contas disponíveis
 * - Mostrar conta ativa
 * - Trocar entre contas
 * - Validar operações de conta
 */
@Injectable()
export class AccountManagementService {
  private readonly logger = new Logger(AccountManagementService.name);

  constructor(
    private readonly userCache: UserCacheService,
    @Optional() private readonly ragService?: RAGService,
  ) {}

  /**
   * Traduz role técnico para label amigável
   */
  private getRoleLabel(role: string): string {
    const roleMap: Record<string, string> = {
      ADMIN: 'Proprietário',
      MEMBER: 'Membro',
      OWNER: 'Proprietário',
      PF: 'Pessoa Física',
      PJ: 'Pessoa Jurídica',
    };
    return roleMap[role] || role;
  }

  /**
   * Lista todas as contas do usuário
   */
  async listUserAccounts(phoneNumber: string): Promise<AccountOperationResult> {
    try {
      this.logger.log(`📋 Listando contas para ${phoneNumber}`);

      const accounts = await this.userCache.listAccounts(phoneNumber);

      if (accounts.length === 0) {
        return {
          success: false,
          message: '❌ Você não possui contas cadastradas.',
        };
      }

      let message = '🏦 *Suas Contas:*\n\n';
      accounts.forEach((acc, index) => {
        const indicator = acc.isActive ? '✅' : '⚪';
        const primaryBadge = acc.isPrimary ? ' 🌟' : '';
        const roleLabel = this.getRoleLabel(acc.type);
        message += `${indicator} ${index + 1}. *${acc.name}* (${roleLabel})${primaryBadge}\n`;
      });

      message += '\n💡 Para trocar de conta, digite: *"mudar conta"* ou *"usar [nome]"*';

      this.logger.log(`✅ ${accounts.length} conta(s) encontrada(s)`);

      return {
        success: true,
        message,
        metadata: { accountCount: accounts.length },
      };
    } catch (error) {
      this.logger.error(`❌ Erro ao listar contas: ${error.message}`, error.stack);
      return {
        success: false,
        message: '❌ Erro ao listar contas. Tente novamente.',
      };
    }
  }

  /**
   * Mostra a conta ativa atual do usuário
   */
  async showActiveAccount(phoneNumber: string): Promise<AccountOperationResult> {
    try {
      this.logger.log(`🔍 Buscando conta ativa para ${phoneNumber}`);

      const activeAccount = await this.userCache.getActiveAccount(phoneNumber);

      if (!activeAccount) {
        return {
          success: false,
          message:
            '❌ Você não possui uma conta ativa.\n\n' +
            '💡 Digite *"minhas contas"* para ver suas contas disponíveis.',
        };
      }

      const primaryBadge = activeAccount.isPrimary ? ' 🌟' : '';
      const roleLabel = this.getRoleLabel(activeAccount.type);
      const message =
        `🏦 *Conta Ativa:*\n\n` +
        `✅ *${activeAccount.name}*\n` +
        `📋 Tipo: ${roleLabel}${primaryBadge}\n\n` +
        `💡 Para trocar de conta, digite: *"mudar conta"*`;

      this.logger.log(`✅ Conta ativa: ${activeAccount.name}`);

      return {
        success: true,
        message,
        metadata: { activeAccount },
      };
    } catch (error) {
      this.logger.error(`❌ Erro ao buscar conta ativa: ${error.message}`, error.stack);
      return {
        success: false,
        message: '❌ Erro ao buscar conta ativa. Tente novamente.',
      };
    }
  }

  /**
   * Troca a conta ativa do usuário
   * Suporta:
   * - Troca direta por nome/tipo (ex: "usar PJ", "usar Pessoal")
   * - Menu interativo (mostra lista de contas)
   */
  async switchAccount(phoneNumber: string, messageText: string): Promise<AccountOperationResult> {
    try {
      this.logger.log(`🔄 Processando troca de conta para ${phoneNumber}`);

      const accounts = await this.userCache.listAccounts(phoneNumber);

      if (accounts.length === 0) {
        return {
          success: false,
          message: '❌ Você não possui contas cadastradas.',
        };
      }

      if (accounts.length === 1) {
        const onlyAccount = accounts[0];
        const roleLabel = this.getRoleLabel(onlyAccount.type);
        return {
          success: true,
          message: `ℹ️ Você possui apenas uma conta: *${onlyAccount.name}* (${roleLabel})`,
          metadata: { singleAccount: true },
        };
      }

      // Tentar identificar conta específica na mensagem
      const targetAccount = this.identifyAccountFromMessage(messageText, accounts);

      if (targetAccount) {
        if (targetAccount.isActive) {
          return {
            success: true,
            message: `ℹ️ A conta *${targetAccount.name}* já está ativa.`,
            metadata: { alreadyActive: true },
          };
        }

        // Trocar para a conta identificada
        await this.userCache.switchAccount(phoneNumber, targetAccount.id);

        // Re-indexar categorias no RAG após trocar conta (apenas da nova conta ativa)
        if (this.ragService) {
          try {
            const user = await this.userCache.getUser(phoneNumber);
            if (user) {
              const categoriesData = await this.userCache.getUserCategories(
                phoneNumber,
                targetAccount.id,
              );
              if (categoriesData.categories.length > 0) {
                // Importar função helper
                const { expandCategoriesForRAG } = await import('../users/user-cache.service');
                const userCategories = expandCategoriesForRAG(categoriesData.categories);

                await this.ragService.indexUserCategories(user.gastoCertoId, userCategories);
                this.logger.log(
                  `🧠 RAG re-indexado após trocar conta: ${userCategories.length} categorias | ` +
                    `Conta: ${targetAccount.name}`,
                );
              }
            }
          } catch (ragError) {
            this.logger.warn(`⚠️ Erro ao re-indexar RAG (não bloqueante):`, ragError);
          }
        }

        const roleLabel = this.getRoleLabel(targetAccount.type);
        this.logger.log(`✅ Conta trocada: ${targetAccount.name} (${targetAccount.type})`);

        return {
          success: true,
          message: `✅ Conta alterada com sucesso!\n\n🏦 Agora usando: *${targetAccount.name}* (${roleLabel})`,
          metadata: { switchedTo: targetAccount },
        };
      }

      // Não identificou conta específica - mostrar menu
      return this.showAccountSelectionMenu(accounts);
    } catch (error) {
      this.logger.error(`❌ Erro ao trocar conta: ${error.message}`, error.stack);
      return {
        success: false,
        message: '❌ Erro ao trocar conta. Tente novamente.',
      };
    }
  }

  /**
   * Processa seleção de conta por número (contexto de menu)
   */
  async selectAccountByNumber(
    phoneNumber: string,
    selection: string,
  ): Promise<AccountOperationResult> {
    try {
      const accounts = await this.userCache.listAccounts(phoneNumber);

      if (accounts.length === 0) {
        return {
          success: false,
          message: '❌ Você não possui contas cadastradas.',
        };
      }

      // Tentar converter seleção em número
      const selectedIndex = parseInt(selection.trim(), 10) - 1;

      if (isNaN(selectedIndex) || selectedIndex < 0 || selectedIndex >= accounts.length) {
        // Tentar como nome/tipo ao invés de número
        const targetAccount = this.identifyAccountFromMessage(selection, accounts);

        if (targetAccount) {
          await this.userCache.switchAccount(phoneNumber, targetAccount.id);
          const roleLabel = this.getRoleLabel(targetAccount.type);
          return {
            success: true,
            message: `✅ Conta alterada para: *${targetAccount.name}* (${roleLabel})`,
          };
        }

        return {
          success: false,
          message:
            '❌ Seleção inválida.\n\n' +
            '💡 Digite o número da conta ou o nome/tipo.\n' +
            'Exemplo: *"1"*, *"PJ"*, *"Pessoal"*',
        };
      }

      const selectedAccount = accounts[selectedIndex];

      if (selectedAccount.isActive) {
        return {
          success: true,
          message: `ℹ️ A conta *${selectedAccount.name}* já está ativa.`,
        };
      }

      await this.userCache.switchAccount(phoneNumber, selectedAccount.id);

      const roleLabel = this.getRoleLabel(selectedAccount.type);
      this.logger.log(`✅ Conta selecionada: ${selectedAccount.name}`);

      return {
        success: true,
        message: `✅ Conta alterada com sucesso!\n\n🏦 Agora usando: *${selectedAccount.name}* (${roleLabel})`,
        metadata: { switchedTo: selectedAccount },
      };
    } catch (error) {
      this.logger.error(`❌ Erro ao selecionar conta: ${error.message}`, error.stack);
      return {
        success: false,
        message: '❌ Erro ao selecionar conta. Tente novamente.',
      };
    }
  }

  /**
   * Valida se usuário tem conta ativa antes de operação
   */
  async validateActiveAccount(phoneNumber: string): Promise<{
    valid: boolean;
    account?: any;
    message?: string;
  }> {
    try {
      const activeAccount = await this.userCache.getActiveAccount(phoneNumber);

      if (!activeAccount) {
        return {
          valid: false,
          message:
            '❌ Você não possui uma conta ativa.\n\n' +
            '💡 Digite *"minhas contas"* para configurar.',
        };
      }

      return {
        valid: true,
        account: activeAccount,
      };
    } catch (error) {
      this.logger.error(`Erro ao validar conta ativa: ${error.message}`);
      return {
        valid: false,
        message: '❌ Erro ao validar conta. Tente novamente.',
      };
    }
  }

  /**
   * Identifica conta específica a partir da mensagem do usuário
   */
  private identifyAccountFromMessage(
    messageText: string,
    accounts: Array<{ id: string; name: string; type: string; isActive: boolean }>,
  ): any | null {
    const normalizedText = messageText.toLowerCase().trim();

    for (const acc of accounts) {
      const accountNameLower = acc.name.toLowerCase();
      const accountTypeLower = acc.type.toLowerCase();

      // Verificar se a mensagem contém o nome ou tipo da conta
      if (normalizedText.includes(accountNameLower) || normalizedText.includes(accountTypeLower)) {
        return acc;
      }

      // Verificar aliases comuns
      const aliases: Record<string, string[]> = {
        personal: ['pessoal', 'pessoa física', 'pf'],
        business: ['pj', 'pessoa jurídica', 'empresa', 'cnpj'],
      };

      for (const [type, aliasList] of Object.entries(aliases)) {
        if (accountTypeLower.includes(type)) {
          for (const alias of aliasList) {
            if (normalizedText.includes(alias)) {
              return acc;
            }
          }
        }
      }
    }

    return null;
  }

  /**
   * Monta menu de seleção de contas
   */
  private showAccountSelectionMenu(
    accounts: Array<{
      id: string;
      name: string;
      type: string;
      isPrimary?: boolean;
      isActive: boolean;
    }>,
  ): AccountOperationResult {
    let message = '🏦 *Escolha uma conta:*\n\n';

    accounts.forEach((acc, index) => {
      const indicator = acc.isActive ? '✅' : `${index + 1}.`;
      const primaryBadge = acc.isPrimary ? ' 🌟' : '';
      const roleLabel = this.getRoleLabel(acc.type);
      message += `${indicator} *${acc.name}* (${roleLabel})${primaryBadge}\n`;
    });

    message +=
      '\n💡 Digite o número da conta ou o nome/tipo:\n' +
      '📝 Exemplos: *"Pessoal"*, *"Empresa"*, *"Casa"*';

    return {
      success: true,
      message,
      requiresConfirmation: true, // Indica que aguarda resposta
      metadata: { awaitingSelection: true, accounts },
    };
  }
}
