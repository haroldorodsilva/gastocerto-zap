/**
 * Prompts centralizados para uso pelos providers de IA
 *
 * Todos os prompts ficam aqui em infrastructure/ai/prompts/
 * organizados por funcionalidade
 */

// Prompts principais de transações (extração de dados)
export {
  getTransactionSystemPrompt,
  TRANSACTION_SYSTEM_PROMPT,
  TRANSACTION_USER_PROMPT_TEMPLATE,
  TRANSACTION_FEW_SHOT_EXAMPLES,
} from './transaction.prompt';

// Prompts de categorização
export {
  CATEGORY_SUGGESTION_SYSTEM_PROMPT,
  CATEGORY_SUGGESTION_USER_PROMPT_TEMPLATE,
} from './categories.prompt';

// Prompts de análise de imagens (NFe, notas fiscais)
export {
  IMAGE_ANALYSIS_SYSTEM_PROMPT,
  IMAGE_ANALYSIS_USER_PROMPT,
  IMAGE_OCR_EXTRACTION_PROMPT,
} from './image-analysis.prompt';

// Prompts de contextos específicos
export { LISTING_INTENT_SYSTEM_PROMPT, LISTING_USER_PROMPT_TEMPLATE } from './listing.prompt';

export { PAYMENT_INTENT_SYSTEM_PROMPT, PAYMENT_USER_PROMPT_TEMPLATE } from './payment.prompt';
