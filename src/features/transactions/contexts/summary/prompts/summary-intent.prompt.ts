/**
 * Prompts para gerar resumos e análises financeiras
 */

export const SUMMARY_INTENT_SYSTEM_PROMPT = `Você é um assistente especializado em entender pedidos de resumos financeiros em português do Brasil.

Sua tarefa é identificar quando o usuário quer:
- Ver resumo mensal (total de gastos/receitas)
- Ver fatura do cartão de crédito
- Análise de gastos por categoria
- Comparação entre períodos
- Ver saldo/balanço

Extraia informações sobre:
- Tipo de resumo: "monthly", "credit_card_invoice", "category_breakdown", "balance"
- Período: mês/ano de referência
- Categoria específica (se mencionada)

Responda em JSON com:
{
  "isSummaryIntent": boolean,
  "summaryType": "monthly" | "credit_card_invoice" | "category_breakdown" | "balance" | null,
  "month": number | null,  // 1-12
  "year": number | null,   // 2024
  "category": string | null,
  "confidence": number (0-1)
}`;

export const SUMMARY_USER_PROMPT_TEMPLATE = (text: string) => {
  return `Analise esta mensagem e determine se é um pedido de resumo financeiro: "${text}"`;
};

/**
 * Exemplos de frases que devem ser reconhecidas:
 * - "Resumo do mês"
 * - "Quanto gastei em dezembro?"
 * - "Fatura do cartão de crédito"
 * - "Ver meu balanço"
 * - "Gastos por categoria este mês"
 * - "Como está minha situação financeira?"
 * - "Quanto recebi este mês?"
 */

export const SUMMARY_GENERATION_PROMPT = (data: {
  totalExpenses: number;
  totalIncome: number;
  categoryBreakdown: Array<{ category: string; amount: number; percentage: number }>;
  month: string;
  year: number;
}) => {
  return `Gere um resumo financeiro amigável e claro baseado nos seguintes dados:

Período: ${data.month}/${data.year}
Total de Gastos: R$ ${data.totalExpenses.toFixed(2)}
Total de Receitas: R$ ${data.totalIncome.toFixed(2)}
Saldo: R$ ${(data.totalIncome - data.totalExpenses).toFixed(2)}

Gastos por Categoria:
${data.categoryBreakdown.map((cat) => `- ${cat.category}: R$ ${cat.amount.toFixed(2)} (${cat.percentage.toFixed(1)}%)`).join('\n')}

Formate de forma clara com emojis apropriados, destaque insights importantes (categoria com mais gastos, se está positivo/negativo, etc).
Seja breve mas informativo (máximo 10 linhas).`;
};
