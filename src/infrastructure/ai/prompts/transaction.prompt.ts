/**
 * Prompts para extração de dados de transações financeiras
 *
 * Usado pelos providers de IA para extrair informações estruturadas
 * de mensagens de texto sobre gastos e receitas
 */

/**
 * Gera o system prompt com a data atual
 */
export const getTransactionSystemPrompt = () => {
  const today = new Date().toISOString().split('T')[0];
  return `Você é um assistente especializado em extrair informações de transações financeiras de textos em português do Brasil.

Sua tarefa é analisar mensagens de usuários e extrair:
- Tipo de transação (EXPENSES para gastos ou INCOME para receitas)
- Valor em reais (convertido para decimal)
- Categoria (use o nome ou ID da categoria fornecida pelo usuário)
- Subcategoria (se houver subcategorias na lista do usuário e fizer sentido usar)
- Descrição (opcional, resumo do que foi gasto/recebido - NUNCA TRUNCAR PALAVRAS)
- Data (formato ISO 8601, se mencionada)
- Estabelecimento/merchant (se mencionado)

IMPORTANTE:
- Converta valores com vírgula para ponto decimal (150,50 vira 150.50)
- Remova pontos de milhar (1.500,00 vira 1500.00)
- Se não houver valor explícito, tente inferir do contexto
- Use a categoria e subcategoria fornecidas pelo usuário quando possível
- Para "mercado" ou "supermercado", use categoria "Alimentação" e subcategoria "Supermercado"
- **DESCRIÇÃO**: Sempre escreva palavras COMPLETAS, NUNCA TRUNCAR (ex: "supermercado", não "supermerca")
- **DESCRIÇÃO**: Extraia APENAS o item/produto específico, NÃO repita categoria, subcategoria, valor ou moeda
- **DESCRIÇÃO**: Se a mensagem menciona um produto específico (ex: "mouse", "teclado", "livro"), use APENAS o nome do produto
- **DESCRIÇÃO**: Remova palavras genéricas que já estão na categoria (ex: se categoria é "Equipamentos", não repita "equipamento" na descrição)
- **DESCRIÇÃO**: Remova valores monetários e moedas (ex: "30 reais", "R$ 50") da descrição
- **DESCRIÇÃO**: Se não houver informação específica além da categoria, deixe description como null
- Sempre responda em JSON válido
- Confidence deve ser um número entre 0 e 1 indicando sua certeza
- **DATA TEMPORAL**: Se o usuário mencionar "ontem", "anteontem", "semana passada", calcule a data correspondente considerando que HOJE é ${today}
  * "ontem" = 1 dia antes de hoje
  * "anteontem" = 2 dias antes de hoje
  * "semana passada" = 7 dias antes de hoje
- Data deve estar no formato ISO 8601 (ex: 2025-12-15T00:00:00.000Z)

Exemplos de categorias comuns:
- Alimentação (subcategorias: Supermercado, Restaurante, Lanche, Delivery)
- Transporte (subcategorias: Combustível, Uber, Ônibus, Estacionamento)
- Saúde, Educação, Lazer, Moradia, Vestuário, Outros`;
};

// Manter compatibilidade com código antigo
export const TRANSACTION_SYSTEM_PROMPT = getTransactionSystemPrompt();

export const TRANSACTION_USER_PROMPT_TEMPLATE = (
  text: string,
  userCategories?: Array<{
    id: string;
    name: string;
    subCategories?: Array<{ id: string; name: string }>;
  }>,
) => {
  let prompt = `Extraia os dados da seguinte mensagem: "${text}"`;

  if (userCategories && userCategories.length > 0) {
    prompt += '\n\n📂 **Categorias disponíveis do usuário:**\n';

    userCategories.forEach((cat) => {
      prompt += `- ${cat.name}`;
      if (cat.subCategories && cat.subCategories.length > 0) {
        prompt += ` (subcategorias: ${cat.subCategories.map((sub) => sub.name).join(', ')})`;
      }
      prompt += '\n';
    });

    prompt += '\n⚠️ **IMPORTANTE:**';
    prompt += '\n- Use EXATAMENTE o nome da categoria e subcategoria listadas acima';
    prompt +=
      '\n- Para "supermercado" ou "mercado", use categoria="Alimentação" e subCategory="Supermercado"';
    prompt += '\n- Para "restaurante", use categoria="Alimentação" e subCategory="Restaurantes"';
    prompt += '\n- Sempre tente identificar a subcategoria quando houver';
    prompt += '\n- Se não houver subcategoria específica, deixe subCategory como null';
  }

  prompt += `\n\nRetorne APENAS um objeto JSON com esta estrutura:
{
  "type": "EXPENSES ou INCOME",
  "amount": 150.50,
  "category": "nome da categoria",
  "subCategory": "nome da subcategoria(opcional)",
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
      description: null,
      date: null,
      merchant: null,
      confidence: 0.95,
    },
  },
  {
    input: 'comprei um mouse para o computador por 30 reais',
    output: {
      type: 'EXPENSES',
      amount: 30.0,
      category: 'Eletrônicos',
      subCategory: 'Equipamentos',
      description: 'Mouse',
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
      category: 'Serviços',
      subCategory: 'Energia',
      description: null,
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
      category: 'Recebimentos',
      subCategory: 'Salário',
      description: null,
      date: null,
      merchant: null,
      confidence: 0.99,
    },
  },
];
