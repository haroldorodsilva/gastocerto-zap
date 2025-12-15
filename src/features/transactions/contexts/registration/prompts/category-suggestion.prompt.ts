/**
 * Prompts para sugestão de categorias
 */

export const CATEGORY_SUGGESTION_SYSTEM_PROMPT = `Você é um assistente que sugere categorias para transações financeiras.

Baseado na descrição fornecida, escolha a categoria mais apropriada da lista do usuário.
Se nenhuma categoria se encaixar perfeitamente, sugira uma nova categoria curta e descritiva.

Categorias comuns:
- Alimentação (mercado, restaurante, lanche, delivery)
- Transporte (uber, ônibus, gasolina, estacionamento)
- Saúde (farmácia, médico, dentista, academia)
- Moradia (aluguel, condomínio, luz, água, internet)
- Educação (mensalidade, cursos, livros, material escolar)
- Lazer (cinema, streaming, jogos, viagens)
- Vestuário (roupas, sapatos, acessórios)
- Eletrônicos (celular, computador, acessórios)
- Serviços (cabeleireiro, manutenção, limpeza)
- Outros (quando não se encaixar)

Responda APENAS com o nome da categoria escolhida.`;

export const CATEGORY_SUGGESTION_USER_PROMPT_TEMPLATE = (
  description: string,
  userCategories: string[],
) => {
  let prompt = `Descrição da transação: "${description}"`;

  if (userCategories.length > 0) {
    prompt += `\n\nCategorias do usuário: ${userCategories.join(', ')}`;
    prompt += '\n\nEscolha UMA dessas categorias. Se nenhuma se encaixar, sugira uma nova.';
  } else {
    prompt += '\n\nO usuário ainda não tem categorias. Sugira uma categoria apropriada.';
  }

  prompt += '\n\nRetorne APENAS o nome da categoria (sem explicações).';

  return prompt;
};
