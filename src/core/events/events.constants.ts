/**
 * Constantes de eventos do sistema
 * Centraliza todos os nomes de eventos para evitar typos
 */

export const EVENTS = {
  // Mensagens
  MESSAGE_RECEIVED: 'message.received',
  MESSAGE_SENT: 'message.sent',
  MESSAGE_FAILED: 'message.failed',

  // Segurança
  SECURITY_VALIDATED: 'security.validated',
  SECURITY_BLOCKED: 'security.blocked',
  SECURITY_RATE_LIMITED: 'security.rate_limited',

  // Usuário
  USER_VERIFIED: 'user.verified',
  USER_NOT_FOUND: 'user.not_found',
  USER_REGISTERED: 'user.registered',
  USER_BLOCKED: 'user.blocked',

  // Onboarding
  ONBOARDING_STARTED: 'onboarding.started',
  ONBOARDING_STEP_COMPLETED: 'onboarding.step.completed',
  ONBOARDING_COMPLETED: 'onboarding.completed',
  ONBOARDING_CANCELLED: 'onboarding.cancelled',

  // Assistente
  INTENT_DETECTED: 'intent.detected',
  QUICK_RESPONSE_SENT: 'quick.response.sent',
  MESSAGE_PROCESSED: 'message.processed',
  MESSAGE_NOT_UNDERSTOOD: 'message.not_understood',

  // Transações
  TRANSACTION_STARTED: 'transaction.started',
  TRANSACTION_CREATED: 'transaction.created',
  TRANSACTION_CONFIRMED: 'transaction.confirmed',
  TRANSACTION_CANCELLED: 'transaction.cancelled',
  TRANSACTION_FAILED: 'transaction.failed',

  // AI/RAG
  AI_PROCESSING_STARTED: 'ai.processing.started',
  AI_PROCESSING_COMPLETED: 'ai.processing.completed',
  AI_PROCESSING_FAILED: 'ai.processing.failed',
  RAG_MATCH_FOUND: 'rag.match.found',
} as const;

/**
 * Tipos de eventos (para type safety)
 */
export type EventType = (typeof EVENTS)[keyof typeof EVENTS];

/**
 * Payloads dos eventos
 */

export interface MessageReceivedEvent {
  messageId: string;
  phoneNumber: string;
  content: string;
  timestamp: Date;
  platform: 'whatsapp' | 'telegram';
  metadata?: Record<string, any>;
}

export interface SecurityValidatedEvent {
  messageId: string;
  phoneNumber: string;
  validatedContent: string;
  securityScore: number;
  validatedAt: Date;
}

export interface SecurityBlockedEvent {
  messageId: string;
  phoneNumber: string;
  reason: 'injection' | 'rate_limit' | 'suspicious' | 'max_length';
  severity: 'low' | 'medium' | 'high';
  details: string;
  blockedAt: Date;
}

export interface UserVerifiedEvent {
  phoneNumber: string;
  userId: string;
  isActive: boolean;
  verifiedAt: Date;
}

export interface UserNotFoundEvent {
  phoneNumber: string;
  messageId: string;
}

export interface OnboardingStartedEvent {
  phoneNumber: string;
  currentStep: string;
  startedAt: Date;
}

export interface IntentDetectedEvent {
  messageId: string;
  phoneNumber: string;
  intent: string;
  confidence: number;
  entities: Record<string, any>;
  detectedAt: Date;
}

export interface QuickResponseSentEvent {
  messageId: string;
  phoneNumber: string;
  response: string;
  responseTime: number; // ms
}

export interface TransactionCreatedEvent {
  transactionId: string;
  phoneNumber: string;
  userId: string;
  accountId: string;
  amount: number;
  type: 'income' | 'expense';
  categoryId: string;
  subCategoryId?: string;
  description: string;
  date: Date;
  needsConfirmation: boolean;
  createdAt: Date;
}

export interface TransactionConfirmedEvent {
  transactionId: string;
  phoneNumber: string;
  confirmedAt: Date;
}

export interface AIProcessingStartedEvent {
  messageId: string;
  provider: string;
  startedAt: Date;
}

export interface AIProcessingCompletedEvent {
  messageId: string;
  provider: string;
  result: any;
  duration: number; // ms
  completedAt: Date;
}
