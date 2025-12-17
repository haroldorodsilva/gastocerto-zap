/**
 * Activity Log Entity
 *
 * Registra todas as ações dos usuários no sistema para auditoria e timeline de atividades
 */
export class ActivityLog {
  id: string;

  // Identificação
  userId: string;
  accountId: string;

  // Ação
  action: ActivityAction;
  entityType: ActivityEntityType;
  entityId: string;

  // Detalhes
  description: string; // Descrição legível para o usuário
  metadata?: Record<string, any>; // Dados adicionais (valores antigos, novos, etc)

  // Contexto
  ipAddress?: string;
  userAgent?: string;

  // Timestamp
  createdAt: Date;
}

/**
 * Tipos de ação que podem ser realizadas
 */
export enum ActivityAction {
  // CRUD básico
  CREATED = "CREATED",
  UPDATED = "UPDATED",
  DELETED = "DELETED",

  // Transações específicas
  TRANSACTION_PAID = "TRANSACTION_PAID",
  TRANSACTION_BANK_CHANGED = "TRANSACTION_BANK_CHANGED",
  TRANSACTION_AMOUNT_CHANGED = "TRANSACTION_AMOUNT_CHANGED",

  // Conta/Usuários
  USER_INVITED = "USER_INVITED",
  USER_REMOVED = "USER_REMOVED",
  INVITE_ACCEPTED = "INVITE_ACCEPTED",

  // Banco
  BANK_BALANCE_ADJUSTED = "BANK_BALANCE_ADJUSTED",

  // Cartão de crédito
  CARD_INVOICE_PAID = "CARD_INVOICE_PAID",
  CARD_INVOICE_CLOSED = "CARD_INVOICE_CLOSED",

  // Metas
  GOAL_CONTRIBUTION = "GOAL_CONTRIBUTION",
  GOAL_ACHIEVED = "GOAL_ACHIEVED",

  // Orçamentos
  BUDGET_EXCEEDED = "BUDGET_EXCEEDED",

  // Outros
  PASSWORD_CHANGED = "PASSWORD_CHANGED",
  TWO_FACTOR_ENABLED = "TWO_FACTOR_ENABLED",
  TWO_FACTOR_DISABLED = "TWO_FACTOR_DISABLED",
}

/**
 * Tipos de entidade que podem ser auditadas
 */
export enum ActivityEntityType {
  TRANSACTION = "TRANSACTION",
  TRANSACTION_FIXED = "TRANSACTION_FIXED",
  BANK = "BANK",
  CREDIT_CARD = "CREDIT_CARD",
  CREDIT_CARD_INVOICE = "CREDIT_CARD_INVOICE",
  CATEGORY = "CATEGORY",
  SUB_CATEGORY = "SUB_CATEGORY",
  BUDGET = "BUDGET",
  GOAL = "GOAL",
  ACCOUNT = "ACCOUNT",
  USER = "USER",
  ACCOUNT_INVITE = "ACCOUNT_INVITE",
}
