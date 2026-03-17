/**
 * Resultado de processamento de mensagem (texto, imagem, áudio)
 *
 * Usado pelo TransactionsService (orchestrator) e pelos IntentHandlers.
 */
export interface ProcessMessageResult {
  success: boolean;
  message: string;
  requiresConfirmation: boolean;
  confirmationId?: string;
  autoRegistered?: boolean;
  platform?: 'whatsapp' | 'telegram' | 'webchat';
  /** Contexto do reply usado pelo PlatformReplyService */
  replyContext?:
    | 'INTENT_RESPONSE'
    | 'CONFIRMATION_REQUEST'
    | 'TRANSACTION_RESULT'
    | 'ERROR';
}
