import { Injectable, Logger } from '@nestjs/common';

/**
 * Item de lista com contexto
 */
export interface ListContextItem {
  id: string; // ID da transação/conta
  type: 'transaction' | 'payment' | 'confirmation';
  description: string;
  amount?: number;
  category?: string;
  metadata?: any; // Dados adicionais
}

/**
 * Contexto de lista do usuário
 */
interface UserListContext {
  phoneNumber: string;
  listType: 'pending_payments' | 'transactions' | 'confirmations';
  items: ListContextItem[];
  createdAt: Date;
  expiresAt: Date;
}

/**
 * ListContextService
 *
 * Gerencia o contexto de listas para permitir referências numéricas.
 * Quando o usuário recebe uma lista (ex: pendentes), pode referenciar
 * itens por número: "pagar 5" paga o item #5 da última lista.
 *
 * Armazenamento: Em memória (pode migrar para Redis no futuro)
 * TTL: 10 minutos
 */
@Injectable()
export class ListContextService {
  private readonly logger = new Logger(ListContextService.name);
  private readonly contexts = new Map<string, UserListContext>();
  private readonly CONTEXT_TTL_MS = 10 * 60 * 1000; // 10 minutos

  /**
   * Armazena contexto de lista para o usuário
   */
  setListContext(
    phoneNumber: string,
    listType: 'pending_payments' | 'transactions' | 'confirmations',
    items: ListContextItem[],
  ): void {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.CONTEXT_TTL_MS);

    this.contexts.set(phoneNumber, {
      phoneNumber,
      listType,
      items,
      createdAt: now,
      expiresAt,
    });

    this.logger.log(
      `📝 Contexto armazenado para ${phoneNumber}: ${listType} (${items.length} itens) | Expira em 10min`,
    );

    // Limpar contextos expirados periodicamente
    this.cleanupExpiredContexts();
  }

  /**
   * Busca item por número da lista (1-indexed)
   */
  getItemByNumber(
    phoneNumber: string,
    itemNumber: number,
  ): {
    found: boolean;
    item?: ListContextItem;
    listType?: string;
    message?: string;
  } {
    const context = this.contexts.get(phoneNumber);

    if (!context) {
      return {
        found: false,
        message:
          '❓ *Nenhuma lista recente encontrada.*\n\n' +
          'Primeiro solicite uma lista:\n' +
          '• "Ver pendentes" ou "Pendentes"\n' +
          '• "Minhas transações"\n\n' +
          'Depois você pode referenciar por número!',
      };
    }

    // Verificar se expirou
    if (new Date() > context.expiresAt) {
      this.contexts.delete(phoneNumber);
      return {
        found: false,
        message:
          '⏰ *Lista expirou (10 minutos).*\n\n' +
          'Por favor, solicite a lista novamente:\n' +
          '• "Ver pendentes"\n' +
          '• "Minhas transações"',
      };
    }

    // Verificar se número é válido (1-indexed)
    if (itemNumber < 1 || itemNumber > context.items.length) {
      return {
        found: false,
        message:
          `❌ *Item #${itemNumber} não encontrado.*\n\n` +
          `A lista tem apenas ${context.items.length} itens.\n` +
          `Por favor, escolha entre 1 e ${context.items.length}.`,
      };
    }

    // Buscar item (converter para 0-indexed)
    const item = context.items[itemNumber - 1];

    this.logger.log(
      `✅ Item #${itemNumber} encontrado: ${item.id} (${item.type}) | Lista: ${context.listType}`,
    );

    return {
      found: true,
      item,
      listType: context.listType,
    };
  }

  /**
   * Busca contexto completo do usuário
   */
  getContext(phoneNumber: string): UserListContext | undefined {
    const context = this.contexts.get(phoneNumber);

    if (!context) {
      return undefined;
    }

    // Verificar se expirou
    if (new Date() > context.expiresAt) {
      this.contexts.delete(phoneNumber);
      return undefined;
    }

    return context;
  }

  /**
   * Limpa contexto do usuário
   */
  clearContext(phoneNumber: string): void {
    if (this.contexts.has(phoneNumber)) {
      this.contexts.delete(phoneNumber);
      this.logger.log(`🗑️  Contexto limpo para ${phoneNumber}`);
    }
  }

  /**
   * Limpa contextos expirados (garbage collection)
   */
  private cleanupExpiredContexts(): void {
    const now = new Date();
    let cleaned = 0;

    for (const [phoneNumber, context] of this.contexts.entries()) {
      if (now > context.expiresAt) {
        this.contexts.delete(phoneNumber);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug(`🗑️  Limpou ${cleaned} contextos expirados`);
    }
  }

  /**
   * Estatísticas de contextos ativos
   */
  getStats(): {
    totalContexts: number;
    byType: Record<string, number>;
  } {
    const stats = {
      totalContexts: this.contexts.size,
      byType: {} as Record<string, number>,
    };

    for (const context of this.contexts.values()) {
      stats.byType[context.listType] = (stats.byType[context.listType] || 0) + 1;
    }

    return stats;
  }
}
