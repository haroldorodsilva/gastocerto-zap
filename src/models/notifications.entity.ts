import { BaseEntity } from './base.entity';
import { User } from './user.entity';
import { Accounts } from './accounts.entity';

export enum NotificationType {
  // Transações
  TRANSACTION_DUE_TODAY = 'TRANSACTION_DUE_TODAY',
  TRANSACTION_DUE_SOON = 'TRANSACTION_DUE_SOON',
  TRANSACTION_OVERDUE = 'TRANSACTION_OVERDUE',
  TRANSACTION_CREATED = 'TRANSACTION_CREATED',
  TRANSACTION_UPDATED = 'TRANSACTION_UPDATED',
  TRANSACTION_DELETED = 'TRANSACTION_DELETED',
  RECURRING_TRANSACTION_PROCESSED = 'RECURRING_TRANSACTION_PROCESSED',

  // Cartão de Crédito
  CREDIT_CARD_INVOICE_DUE_TODAY = 'CREDIT_CARD_INVOICE_DUE_TODAY',
  CREDIT_CARD_INVOICE_DUE_SOON = 'CREDIT_CARD_INVOICE_DUE_SOON',
  CREDIT_CARD_INVOICE_OVERDUE = 'CREDIT_CARD_INVOICE_OVERDUE',
  CREDIT_CARD_LIMIT_EXCEEDED = 'CREDIT_CARD_LIMIT_EXCEEDED',
  CREDIT_CARD_LIMIT_WARNING = 'CREDIT_CARD_LIMIT_WARNING',
  CREDIT_CARD_CREATED = 'CREDIT_CARD_CREATED',
  CREDIT_CARD_STATEMENT_READY = 'CREDIT_CARD_STATEMENT_READY',

  // Resumos
  DAILY_SUMMARY = 'DAILY_SUMMARY',
  WEEKLY_SUMMARY = 'WEEKLY_SUMMARY',

  // Orçamento
  BUDGET_EXCEEDED = 'BUDGET_EXCEEDED',
  BUDGET_WARNING = 'BUDGET_WARNING',

  // Metas
  GOAL_ACHIEVED = 'GOAL_ACHIEVED',
  GOAL_WARNING = 'GOAL_WARNING',
  GOAL_DEADLINE_APPROACHING = 'GOAL_DEADLINE_APPROACHING',

  // Convites de Conta
  ACCOUNT_INVITATION = 'ACCOUNT_INVITATION',
  ACCOUNT_INVITE_SENT = 'ACCOUNT_INVITE_SENT',
  ACCOUNT_INVITE_ACCEPTED = 'ACCOUNT_INVITE_ACCEPTED',
  ACCOUNT_INVITE_REJECTED = 'ACCOUNT_INVITE_REJECTED',
  ACCOUNT_INVITE_REVOKED = 'ACCOUNT_INVITE_REVOKED',
  ACCOUNT_MEMBER_REMOVED = 'ACCOUNT_MEMBER_REMOVED',
  ACCOUNT_ROLE_CHANGED = 'ACCOUNT_ROLE_CHANGED',

  // Segurança
  SECURITY_LOGIN_NEW_DEVICE = 'SECURITY_LOGIN_NEW_DEVICE',
  SECURITY_2FA_ENABLED = 'SECURITY_2FA_ENABLED',
  SECURITY_2FA_DISABLED = 'SECURITY_2FA_DISABLED',
  SECURITY_PASSWORD_CHANGED = 'SECURITY_PASSWORD_CHANGED',

  // Autenticação (Sistema - sempre enviadas)
  ACCOUNT_VALIDATION = 'ACCOUNT_VALIDATION',
  PASSWORD_RECOVERY = 'PASSWORD_RECOVERY',
  LOGIN_VALIDATION = 'LOGIN_VALIDATION',

  GENERIC_NOTIFICATION = 'GENERIC_NOTIFICATION',
}

export enum NotificationChannel {
  EMAIL = 'EMAIL',
  PUSH = 'PUSH',
  SMS = 'SMS',
  DISCORD = 'DISCORD',
}

export enum NotificationStatus {
  PENDING = 'PENDING',
  SENT = 'SENT',
  FAILED = 'FAILED',
  READ = 'READ',
}

export enum NotificationPriority {
  LOW = 'LOW',
  NORMAL = 'NORMAL',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

export class NotificationPreferences extends BaseEntity {
  userId: string;
  enableEmail: boolean;

  // Configurações de transações
  enableTransactionDueAlerts: boolean;
  transactionPaymentDueDays: number;

  enableCreditCardAlerts: boolean;
  enableCreditCardInvoiceDueAlerts: boolean;

  // Configurações de resumos
  enableDailySummary: boolean;
  enableWeeklySummary: boolean;

  // Configurações de notificações de segurança e convites
  enableSecurityAlerts: boolean;
  enableAccountInvites: boolean;

  // Configurações de agrupamento de notificações
  enableNotificationGrouping: boolean;
  notificationGroupingWindow: number;

  enableBudgetAlerts: boolean;
  enableGoalAlerts: boolean;
}

export class NotificationPreferencesRelations extends NotificationPreferences {
  user?: User;
}

export class Notification extends BaseEntity {
  userId: string;
  accountId?: string;
  type: NotificationType;
  priority: NotificationPriority;
  status: NotificationStatus;

  title: string;
  message: string;
  data?: any;

  channels: NotificationChannel[];
  scheduledFor?: Date;
  sentAt?: Date;
  readAt?: Date;

  entityType?: string;
  entityId?: string;

  attempts: number;
  lastError?: string;
}

export class NotificationRelations extends Notification {
  user?: User;
  account?: Accounts;
}

export class NotificationTemplate extends BaseEntity {
  type: NotificationType;
  name: string;

  emailSubject?: string;
  emailTemplate?: string;
  pushTitle?: string;
  pushBody?: string;
  smsMessage?: string;

  isActive: boolean;
  variables?: any;
}

// Template variable shapes for invite-related notifications
export interface AccountInviteTemplateData {
  inviterName: string;
  accountId: string;
  accountName: string;
  inviteLink: string; // full URL for CTA
  inviteHash: string;
  role: 'USER' | 'ADMIN';
  expiresAt: string; // ISO timestamp
  additionalNote?: string;
  invitedEmail?: string;
  invitedUserId?: string;
}

export interface AccountInviteAcceptedTemplateData {
  accepterName: string;
  accepterEmail?: string;
  accepterUserId?: string;
  accountId: string;
  accountName: string;
  role: 'USER' | 'ADMIN';
  acceptedAt: string; // ISO timestamp
  inviteHash?: string;
  inviterName?: string;
}
