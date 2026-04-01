/**
 * Sistema de variações de respostas para humanizar o bot.
 * Cada tipo de resposta tem múltiplas variações para evitar repetição.
 */

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ──────────────────────────────────────────────
// Saudações contextuais
// ──────────────────────────────────────────────

export function getHumanGreeting(userName?: string): string {
  const hour = new Date().getHours();
  const name = userName ? `, ${userName.split(' ')[0]}` : '';

  if (hour >= 5 && hour < 12) {
    return pick([
      `Bom dia${name}! ☀️ Como posso te ajudar?`,
      `Oi${name}! Bom dia! ☀️ O que precisa?`,
      `Bom dia${name}! ☀️ Tô por aqui, manda ver!`,
    ]);
  } else if (hour >= 12 && hour < 18) {
    return pick([
      `Boa tarde${name}! 🌤️ Como posso te ajudar?`,
      `Oi${name}! Boa tarde! 🌤️ O que precisa?`,
      `E aí${name}! 🌤️ Tô por aqui, manda!`,
    ]);
  } else {
    return pick([
      `Boa noite${name}! 🌙 Como posso te ajudar?`,
      `Oi${name}! Boa noite! 🌙 O que precisa?`,
      `Boa noite${name}! 🌙 Tô por aqui, manda!`,
    ]);
  }
}

export function getHowAreYouReply(): string {
  return pick(['Tudo ótimo por aqui! 😊', 'Tudo bem! 😊', 'Tudo certo! 👍', 'Muito bem! 😄']);
}

// ──────────────────────────────────────────────
// Mensagem UNKNOWN (não entendeu)
// ──────────────────────────────────────────────

export function getUnknownMessage(): string {
  const intro = pick([
    'Hmm, não entendi essa 🤔',
    'Opa, não consegui entender 🤔',
    'Não entendi o que quis dizer 🤔',
    'Hmm, pode reformular? 🤔',
  ]);

  return (
    `${intro}\n\n` +
    '💡 *Algumas coisas que posso fazer:*\n\n' +
    '💸 Registrar gastos — _"Gastei 50 no mercado"_\n' +
    '📊 Ver resumo — _"Resumo do mês"_ ou _"Meu saldo"_\n' +
    '📋 Listar transações — _"Minhas transações"_\n' +
    '📂 Análise — _"Gastos por categoria"_\n' +
    '📷 Envie foto de nota fiscal\n' +
    '🎤 Grave um áudio\n\n' +
    'Digite *"ajuda"* pra ver tudo que posso fazer 😊'
  );
}

// ──────────────────────────────────────────────
// Mensagem de HELP
// ──────────────────────────────────────────────

export function getHelpMessage(): string {
  return (
    '📖 *Como posso te ajudar*\n\n' +
    '💸 *Registrar transações:*\n' +
    '   _"Gastei 50 no mercado"_\n' +
    '   _"Recebi 1000 de salário"_\n' +
    '   _"Gastei 300 no cartão em 3x"_\n\n' +
    '📊 *Resumos e gráficos:*\n' +
    '   _"Meu saldo"_ — Balanço geral\n' +
    '   _"Resumo do mês"_ — Resumo detalhado\n' +
    '   _"Gastos por categoria"_ — Por categoria\n' +
    '   _"Gráfico"_ — Gráfico de gastos por categoria\n\n' +
    '📋 *Transações:*\n' +
    '   _"Minhas transações"_ — Do mês\n' +
    '   _"Transações de fevereiro"_ — Outro mês\n' +
    '   _"Últimas 5 transações"_\n\n' +
    '💳 *Cartões e faturas:*\n' +
    '   _"Meus cartões"_ — Listar cartões\n' +
    '   _"Cartão padrão"_ — Ver cartão padrão\n' +
    '   _"Minhas faturas"_ — Ver faturas\n' +
    '   _"Fatura nubank"_ — Fatura de um cartão\n' +
    '   _"Pagar fatura"_ — Pagar fatura do cartão\n\n' +
    '📋 *Pendentes:*\n' +
    '   _"Pendentes"_ — Contas a pagar/receber\n' +
    '   _"Pagar conta"_ — Marcar conta como paga\n\n' +
    '🏦 *Perfil:*\n' +
    '   _"Meus perfis"_ — Ver contas\n' +
    '   _"Conta ativa"_ — Ver conta atual\n' +
    '   _"Trocar perfil"_ — Mudar conta\n\n' +
    '📷 Envie foto de nota fiscal\n' +
    '🎤 Grave um áudio descrevendo\n\n' +
    'Use linguagem natural, tô aqui pra facilitar! 😊'
  );
}

// ──────────────────────────────────────────────
// Comentários contextuais para listagem
// ──────────────────────────────────────────────

export function getListingIntro(count: number): string {
  if (count === 0) return '';

  return pick([
    `Aqui estão suas transações! 📋`,
    `Encontrei tudo pra você! 📋`,
    `Dá uma olhada! 📋`,
  ]);
}

export function getBalanceComment(
  expenseTotal: number,
  incomeTotal: number,
  finalBalance: number,
): string {
  // Valores em centavos
  if (finalBalance > 0) {
    const ratio = expenseTotal / (incomeTotal || 1);
    if (ratio < 0.5) {
      return pick([
        'Mês bem controlado! Sobrando bastante 👏',
        'Tá sobrando uma boa! Continue assim 💪',
      ]);
    }
    return pick(['Saldo positivo! 👍', 'No azul! 😊']);
  } else if (finalBalance === 0) {
    return 'Zerado este mês! Tá no equilíbrio ⚖️';
  } else {
    return pick([
      'Mês um pouco apertado 💪 Quer ver onde tá gastando mais? Diz _"gastos por categoria"_',
      'No vermelho este mês 😬 Diz _"gastos por categoria"_ pra ver onde cortar',
    ]);
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getEmptyListMessage(_context?: string): string {
  const base = pick([
    'Nada por aqui ainda! 📭',
    'Tudo limpo! 📭',
    'Nenhuma transação encontrada 📭',
  ]);

  return `${base}\n\n_Pra registrar, é só dizer:_\n💬 _"Gastei 50 no mercado"_`;
}

// ──────────────────────────────────────────────
// Sugestões proativas pós-ação
// ──────────────────────────────────────────────

export function getPostActionSuggestion(completedIntent: string): string {
  switch (completedIntent) {
    case 'REGISTER_TRANSACTION':
      return pick([
        '\n\n💡 _Dica: Diz "resumo" pra ver como ficou o mês_',
        '\n\n💡 _Quer registrar mais alguma? É só mandar!_',
        '',
      ]);
    case 'LIST_TRANSACTIONS':
      return pick([
        '\n\n💡 _Dica: Diz "gastos por categoria" pra ver o detalhamento_',
        '\n\n💡 _Dica: Diz "resumo" pra ver o balanço do mês_',
        '',
      ]);
    case 'MONTHLY_SUMMARY':
      return pick(['\n\n💡 _Dica: Diz "gastos por categoria" pra entrar no detalhe_', '']);
    case 'CATEGORY_BREAKDOWN':
      return pick(['\n\n💡 _Dica: Diz "minhas transações" pra ver a lista completa_', '']);
    default:
      return '';
  }
}

// ──────────────────────────────────────────────
// Comentários contextuais para resumos/saldo
// ──────────────────────────────────────────────

export function getSummaryIntro(monthName: string): string {
  return pick([
    `Aqui vai o resumo de ${monthName}! 📊`,
    `Preparei o resumo de ${monthName} pra você! 📊`,
    `Vamos ver como foi ${monthName}:`,
  ]);
}

export function getBalanceSummaryIntro(): string {
  return pick([
    'Aqui tá o panorama das suas finanças! 💰',
    'Vamos ver como estão as finanças! 💰',
    'Olha só o seu resumo financeiro! 💰',
  ]);
}

export function getSummaryBalanceComment(balance: number, income: number, expense: number): string {
  if (income === 0 && expense === 0) {
    return 'Mês tranquilo, sem movimentação por enquanto 🤷';
  }

  const ratio = expense / (income || 1);

  if (balance > 0) {
    if (ratio < 0.5) {
      return pick([
        'Arrasou! Gastou menos da metade do que ganhou 🎉',
        'Mandou bem demais! Sobrando bastante 💪',
      ]);
    }
    if (ratio < 0.8) {
      return pick([
        'No azul! Tá indo bem 😊',
        'Saldo positivo, bom sinal! 👍',
      ]);
    }
    return pick([
      'No positivo, mas ficou apertado. Atenção nos próximos gastos! ⚠️',
      'Sobrou pouco esse mês... tenta segurar um pouco 😅',
    ]);
  }

  if (balance === 0) {
    return 'Zerado! Nem sobrou, nem faltou ⚖️';
  }

  // Negativo
  return pick([
    'Mês no vermelho 😬 Diz _"gastos por categoria"_ pra ver onde cortar.',
    'Gastou mais do que entrou... vamos ver onde dá pra economizar? Diz _"gastos por categoria"_.',
  ]);
}

export function getCategoryInsight(topCategory: string, percentage: number): string {
  if (percentage > 50) {
    return `Mais da metade foi em *${topCategory}* — tá concentrado aí! 👀`;
  }
  if (percentage > 30) {
    return `*${topCategory}* puxou bastante esse mês 📌`;
  }
  return `Seus gastos estão bem distribuídos, tá no controle! 👏`;
}

export function getPredictedBalanceComment(predicted: number): string {
  if (predicted > 0) {
    return pick([
      'A previsão tá positiva! Continue assim 📈',
      'Pelo que vejo, o mês vai fechar no azul 📈',
    ]);
  }
  return pick([
    'Pelo andar da carruagem, pode fechar no vermelho... atenção! 📉',
    'A previsão tá negativa... bora segurar os gastos? 📉',
  ]);
}
