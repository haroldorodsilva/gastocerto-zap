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
      this.logger.log(`📋 Listando perfis para ${phoneNumber}`);

      const accounts = await this.userCache.listAccounts(phoneNumber);

      if (accounts.length === 0) {
        return {
          success: false,
          message: '❌ Você não possui perfis cadastrados.',
        };
      }

      let message = '🏦 *Seus Perfis:*\n\n';
      accounts.forEach((acc, index) => {
        const indicator = acc.isActive ? '✅' : '⚪';
        const primaryBadge = acc.isPrimary ? ' 🌟' : '';
        // const roleLabel = this.getRoleLabel(acc.type);
        message += `${indicator} ${index + 1}. *${acc.name}* ${primaryBadge}\n`;
      });

      message += '\n💡 Para trocar de perfil, digite: *"mudar perfil"* ou *"usar [nome]"*';

      this.logger.log(`✅ ${accounts.length} perfil(s) encontrado(s)`);

      return {
        success: true,
        message,
        metadata: { accountCount: accounts.length },
      };
    } catch (error) {
      this.logger.error(`❌ Erro ao listar perfis: ${error.message}`, error.stack);
      return {
        success: false,
        message: '❌ Erro ao listar perfis. Tente novamente.',
      };
    }
  }

  /**
   * Mostra a conta ativa atual do usuário
   */
  async showActiveAccount(phoneNumber: string): Promise<AccountOperationResult> {
    try {
      this.logger.log(`🔍 Buscando perfil ativo para ${phoneNumber}`);

      const activeAccount = await this.userCache.getActiveAccount(phoneNumber);

      if (!activeAccount) {
        return {
          success: false,
          message:
            '❌ Você não possui um perfil ativo.\n\n' +
            '💡 Digite *"meus perfis"* para ver seus perfis disponíveis.',
        };
      }

      const primaryBadge = activeAccount.isPrimary ? ' 🌟' : '';
      const roleLabel = this.getRoleLabel(activeAccount.type);
      const message =
        `🏦 *Conta Ativa:*\n\n` +
        `✅ *${activeAccount.name}*\n` +
        `📋 Tipo: ${roleLabel}${primaryBadge}\n` +
        // `🆔 ID: ${activeAccount.id}\n\n` +
        `💡 Para trocar de perfil, digite: *"mudar perfil"*`;

      this.logger.log(`✅ Perfil ativo: ${activeAccount.name} (ID: ${activeAccount.id})`);

      return {
        success: true,
        message,
        metadata: { activeAccount },
      };
    } catch (error) {
      this.logger.error(`❌ Erro ao buscar perfil ativo: ${error.message}`, error.stack);
      return {
        success: false,
        message: '❌ Erro ao buscar perfil ativo. Tente novamente.',
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
      this.logger.log(`🔄 Processando troca de perfil para ${phoneNumber}`);

      const accounts = await this.userCache.listAccounts(phoneNumber);

      if (accounts.length === 0) {
        return {
          success: false,
          message: '❌ Você não possui perfis cadastrados.',
        };
      }

      if (accounts.length === 1) {
        const onlyAccount = accounts[0];
        const roleLabel = this.getRoleLabel(onlyAccount.type);
        return {
          success: true,
          message: `ℹ️ Você possui apenas um perfil: *${onlyAccount.name}* (${roleLabel})`,
          metadata: { singleAccount: true },
        };
      }

      // Tentar identificar conta específica na mensagem
      const targetAccount = this.identifyAccountFromMessage(messageText, accounts);

      if (targetAccount) {
        if (targetAccount.isActive) {
          return {
            success: true,
            message: `ℹ️ O perfil *${targetAccount.name}* já está ativo.`,
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
                  `🧠 RAG re-indexado após trocar perfil: ${userCategories.length} categorias | ` +
                    `Perfil: ${targetAccount.name}`,
                );
              }
            }
          } catch (ragError) {
            this.logger.warn(`⚠️ Erro ao re-indexar RAG (não bloqueante):`, ragError);
          }
        }

        const roleLabel = this.getRoleLabel(targetAccount.type);
        this.logger.log(`✅ Perfil trocado: ${targetAccount.name} (${targetAccount.type})`);

        return {
          success: true,
          message: `✅ Perfil alterado com sucesso!\n\n🏦 Agora usando: *${targetAccount.name}* (${roleLabel})`,
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
          message: '❌ Você não possui perfis cadastrados.',
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
            message: `✅ Perfil alterado para: *${targetAccount.name}* (${roleLabel})`,
          };
        }

        return {
          success: false,
          message:
            '❌ Seleção inválida.\n\n' +
            '💡 Digite o nome/tipo.\n' +
            'Exemplo: *"PJ"*, *"Pessoal"*',
        };
      }

      const selectedAccount = accounts[selectedIndex];

      if (selectedAccount.isActive) {
        return {
          success: true,
          message: `ℹ️ O perfil *${selectedAccount.name}* já está ativo.`,
        };
      }

      await this.userCache.switchAccount(phoneNumber, selectedAccount.id);

      const roleLabel = this.getRoleLabel(selectedAccount.type);
      this.logger.log(`✅ Perfil selecionado: ${selectedAccount.name}`);

      return {
        success: true,
        message: `✅ Perfil alterado com sucesso!\n\n🏦 Agora usando: *${selectedAccount.name}* (${roleLabel})`,
        metadata: { switchedTo: selectedAccount },
      };
    } catch (error) {
      this.logger.error(`❌ Erro ao selecionar perfil: ${error.message}`, error.stack);
      return {
        success: false,
        message: '❌ Erro ao selecionar perfil. Tente novamente.',
      };
    }
  }

  /**
   * Valida se usuário tem conta ativa antes de operação
   *
   * ⚠️ PONTO ÚNICO DE VALIDAÇÃO
   * Este método deve ser chamado no início de TODA operação que requer conta ativa.
   *
   * Retorna:
   * - valid: se tem conta ativa ou não
   * - account: dados completos da conta ativa (id, name, type, isPrimary)
   * - message: mensagem de erro amigável para o usuário (se valid = false)
   */
  async validateActiveAccount(phoneNumber: string): Promise<{
    valid: boolean;
    account?: { id: string; name: string; type: string; isPrimary?: boolean };
    message?: string;
  }> {
    try {
      this.logger.debug(`🔍 Validando conta ativa para ${phoneNumber}`);

      const activeAccount = await this.userCache.getActiveAccount(phoneNumber);

      if (!activeAccount) {
        this.logger.warn(`❌ Nenhuma conta ativa encontrada para ${phoneNumber}`);
        return {
          valid: false,
          message:
            '❌ Você não possui um perfil ativo.\n\n' +
            '💡 Digite *"meus perfis"* para configurar.',
        };
      }

      this.logger.debug(`✅ Conta ativa encontrada: ${activeAccount.name} (${activeAccount.id})`);

      return {
        valid: true,
        account: activeAccount,
      };
    } catch (error) {
      this.logger.error(`Erro ao validar perfil ativo: ${error.message}`, error.stack);
      return {
        valid: false,
        message: '❌ Erro ao validar perfil. Tente novamente.',
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

    // Remover palavras comuns de comando
    const cleanedText = normalizedText
      .replace(/^(usar|usar o|usar a|trocar para|mudar para|selecionar|escolher)\s+/i, '')
      .trim();

    for (const acc of accounts) {
      const accountNameLower = acc.name.toLowerCase();
      const accountTypeLower = acc.type.toLowerCase();

      // 1. Verificar match exato do nome completo ou tipo
      if (cleanedText === accountNameLower || cleanedText === accountTypeLower) {
        return acc;
      }

      // 2. Verificar se a mensagem contém o nome ou tipo da conta
      if (normalizedText.includes(accountNameLower) || normalizedText.includes(accountTypeLower)) {
        return acc;
      }

      // 3. Buscar por palavras individuais do nome da conta
      // Ex: "hrs" deve encontrar "HRS Tecnologia"
      const accountWords = accountNameLower.split(/\s+/);
      for (const word of accountWords) {
        if (word.length >= 3 && cleanedText.includes(word)) {
          return acc;
        }
        // Match parcial para palavras pequenas (siglas)
        if (word.length >= 2 && cleanedText === word) {
          return acc;
        }
      }

      // 4. Verificar se o texto digitado inicia alguma palavra do nome
      // Ex: "tec" deve encontrar "HRS Tecnologia"
      for (const word of accountWords) {
        if (word.startsWith(cleanedText) && cleanedText.length >= 3) {
          return acc;
        }
      }

      // 5. Verificar aliases comuns
      const aliases: Record<string, string[]> = {
        personal: ['pessoal', 'pessoa física', 'pf', 'fisica'],
        business: ['pj', 'pessoa jurídica', 'empresa', 'cnpj', 'juridica'],
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
    let message = '🏦 *Escolha um perfil:*\n\n';

    accounts.forEach((acc, index) => {
      const indicator = acc.isActive ? '✅' : `${index + 1}.`;
      const primaryBadge = acc.isPrimary ? ' 🌟' : '';
      const roleLabel = this.getRoleLabel(acc.type);
      message += `${indicator} *${acc.name}* (${roleLabel})${primaryBadge}\n`;
    });

    message +=
      '\n💡 Digite o número do perfil ou o nome/tipo:\n' +
      '📝 Exemplos: *"Pessoal"*, *"Empresa"*, *"Casa"*';

    return {
      success: true,
      message,
      requiresConfirmation: true, // Indica que aguarda resposta
      metadata: { awaitingSelection: true, accounts },
    };
  }
}
