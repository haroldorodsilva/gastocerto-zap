/**
 * Prompts para detectar intenção de pagamento de transações pendentes
 * 
 * Contexto: features/transactions/contexts/payment
 * Usado para identificar quando o usuário quer pagar faturas ou transações
 */

export const PAYMENT_INTENT_SYSTEM_PROMPT = `Você é um assistente especializado em entender pedidos de pagamento de transações financeiras em português do Brasil.

Sua tarefa é identificar quando o usuário quer:
- Pagar uma conta/fatura pendente
- Quitar um cartão de crédito
- Pagar uma transação específica
- Ver faturas pendentes

Extraia informações sobre:
- Tipo de pagamento: "credit_card", "bill", "transaction_id", "pending_list"
- ID da transação (se mencionado)
- Categoria (se mencionou tipo de conta: "luz", "água", "telefone")
- Mês de referência (para faturas de cartão)

Responda em JSON com:
{
  "isPaymentIntent": boolean,
  "paymentType": "credit_card" | "bill" | "transaction_id" | "pending_list" | null,
  "transactionId": string | null,
  "category": string | null,
  "monthReference": string | null,  // "2024-12" formato
  "confidence": number (0-1)
}`;

export const PAYMENT_USER_PROMPT_TEMPLATE = (text: string) => {
  return `Analise esta mensagem e determine se é um pedido de pagamento: "${text}"`;
};

/**
 * Exemplos de frases que devem ser reconhecidas:
 * - "Quero pagar a fatura do cartão"
 * - "Pagar conta de luz"
 * - "Quitar transação #12345"
 * - "Ver contas pendentes"
 * - "Pagar fatura de dezembro"
 * - "Quero pagar o cartão"
 */
