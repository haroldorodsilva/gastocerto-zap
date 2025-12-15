/**
 * Prompts otimizados para extração de dados de transações
 */

export const TRANSACTION_SYSTEM_PROMPT = `Você é um assistente especializado em extrair informações de transações financeiras de textos em português do Brasil.

Sua tarefa é analisar mensagens de usuários e extrair:
- Tipo de transação (EXPENSES para gastos ou INCOME para receitas)
- Valor em reais (convertido para decimal)
- Categoria (use o nome ou ID da categoria fornecida pelo usuário)
- Subcategoria (se houver subcategorias na lista do usuário e fizer sentido usar)
- Descrição (opcional, resumo do que foi gasto/recebido)
- Data (formato ISO 8601, se mencionada)
- Estabelecimento/merchant (se mencionado)

IMPORTANTE:
- Converta valores com vírgula para ponto decimal (150,50 vira 150.50)
- Remova pontos de milhar (1.500,00 vira 1500.00)
- Se não houver valor explícito, tente inferir do contexto
- Use a categoria e subcategoria fornecidas pelo usuário quando possível
- Para "mercado" ou "supermercado", use categoria "Alimentação" e subcategoria "Supermercado"
- Sempre responda em JSON válido
- Confidence deve ser um número entre 0 e 1 indicando sua certeza
- Data deve estar no formato ISO 8601 (ex: 2025-12-12T10:00:00.000Z)

Exemplos de categorias comuns:
- Alimentação (subcategorias: Supermercado, Restaurante, Lanche, Delivery)
- Transporte (subcategorias: Combustível, Uber, Ônibus, Estacionamento)
- Saúde, Educação, Lazer, Moradia, Vestuário, Outros`;

export const TRANSACTION_USER_PROMPT_TEMPLATE = (text: string, userCategories?: string[]) => {
  let prompt = `Extraia os dados da seguinte mensagem: "${text}"`;

  if (userCategories && userCategories.length > 0) {
    prompt += `\n\nCategorias preferidas do usuário: ${userCategories.join(', ')}`;
    prompt += '\nSe possível, use uma dessas categorias. Caso não se encaixe, sugira uma nova.';
  }

  prompt += `\n\nRetorne APENAS um objeto JSON com esta estrutura:
{
  "type": "EXPENSES ou INCOME",
  "amount": 150.50,
  "category": "nome da categoria ou UUID",
  "subCategory": "nome da subcategoria ou UUID (opcional)",
  "description": "string ou null",
  "date": "2025-12-12T10:00:00.000Z ou null (formato ISO 8601)",
  "merchant": "string ou null",
  "confidence": 0.95
}`;

  return prompt;
};

/**
 * Few-shot examples para melhorar precisão
 */
export const TRANSACTION_FEW_SHOT_EXAMPLES = [
  {
    input: 'Gastei 50 no mercado',
    output: {
      type: 'EXPENSES',
      amount: 50.0,
      category: 'Alimentação',
      subCategory: 'Supermercado',
      description: 'Compras no mercado',
      date: null,
      merchant: null,
      confidence: 0.95,
    },
  },
  {
    input: 'Paguei R$ 150,50 na conta de luz',
    output: {
      type: 'EXPENSES',
      amount: 150.5,
      category: 'Moradia',
      subCategory: 'Contas',
      description: 'Conta de luz',
      date: null,
      merchant: null,
      confidence: 0.98,
    },
  },
  {
    input: 'Recebi 1.500,00 de salário',
    output: {
      type: 'INCOME',
      amount: 1500.0,
      category: 'Salário',
      subCategory: null,
      description: 'Salário mensal',
      date: null,
      merchant: null,
      confidence: 0.99,
    },
  },
  {
    input: 'Uber ontem 25 reais',
    output: {
      type: 'EXPENSES',
      amount: 25.0,
      category: 'Transporte',
      subCategory: 'Uber',
      description: 'Corrida de Uber',
      date: null,
      merchant: 'Uber',
      confidence: 0.92,
    },
  },
  {
    input: 'Academia 89,90 todo dia 5',
    output: {
      type: 'EXPENSES',
      amount: 89.9,
      category: 'Saúde',
      subCategory: 'Academia',
      description: 'Mensalidade da academia',
      date: null,
      merchant: null,
      confidence: 0.9,
    },
  },
];
