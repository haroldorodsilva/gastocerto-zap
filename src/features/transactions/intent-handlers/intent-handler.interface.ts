import { UserCache } from '@prisma/client';
import { MessageIntent, IntentAnalysisResult } from '@features/intent/intent-analyzer.service';
import { ProcessMessageResult } from '../transactions.types';

/**
 * Contexto passado para cada IntentHandler na fase de despacho
 */
export interface IntentHandlerContext {
  /** Objeto UserCache completo (já buscado pelo provedor) */
  user: UserCache;
  /** Texto da mensagem do usuário */
  text: string;
  /** ID único da mensagem */
  messageId: string;
  /** Plataforma de origem */
  platform: 'whatsapp' | 'telegram' | 'webchat';
  /** ID específico da plataforma (chatId, número, etc) */
  platformId?: string;
  /** ID da conta ativa (já resolvido) */
  accountId?: string;
  /** Número de telefone do usuário */
  phoneNumber: string;
  /** Resultado da análise de intenção (NLP) */
  intentResult: IntentAnalysisResult;
}

/**
 * Interface Strategy para handlers de intenção
 *
 * Cada handler gerencia um conjunto de MessageIntents
 * e implementa a lógica de negócio correspondente.
 *
 * O TransactionsService (orchestrator) usa um Map<MessageIntent, IntentHandler>
 * para despachar para o handler correto, eliminando o if/else chain de ~300 linhas.
 */
export interface IntentHandler {
  /** Intents que este handler suporta */
  readonly supportedIntents: MessageIntent[];

  /** Processa a intenção e retorna o resultado */
  handle(ctx: IntentHandlerContext): Promise<ProcessMessageResult>;
}

/** Token de injeção DI para o array de IntentHandlers */
export const INTENT_HANDLERS = 'INTENT_HANDLERS';
