/**
 * Keyword data for IntentAnalyzerService.
 *
 * Extracted to a separate file so the service contains only matching logic.
 * Future phase (#20) will load these from the database instead of this file.
 *
 * Each constant maps to one `is*()` matcher in IntentAnalyzerService.
 */

// ──────────────────────────────────────────────
// Greetings
// ──────────────────────────────────────────────
export const GREETING_KEYWORDS = [
  '/start',
  'oi',
  'olá',
  'ola',
  'hey',
  'opa',
  'bom dia',
  'boa tarde',
  'boa noite',
  'e aí',
  'eai',
  'tudo bem',
  'como vai',
  'como você está',
  'tudo bom',
  'beleza',
  'fala aí',
  'fala',
] as const;

export const HOW_ARE_YOU_KEYWORDS = [
  'tudo bem',
  'como vai',
  'como você está',
  'tudo bom',
  'beleza',
] as const;

// ──────────────────────────────────────────────
// Confirmation responses (sim/não)
// ──────────────────────────────────────────────
export const YES_RESPONSES = [
  'sim',
  's',
  'yes',
  'confirmar',
  'confirmo',
  'ok',
  'okay',
  'pode ser',
  'isso',
  'exato',
  'correto',
  'certo',
  'fecho',
  'isso aí',
  'bom demais',
] as const;

export const NO_RESPONSES = [
  'não',
  'nao',
  'n',
  'no',
  'cancelar',
  'cancela',
  'não quero',
  'nao quero',
  'errado',
  'deixa',
] as const;

// ──────────────────────────────────────────────
// Help
// ──────────────────────────────────────────────
export const HELP_KEYWORDS = [
  'ajuda',
  'help',
  'como funciona',
  'como usar',
  'como faço',
  'o que fazer',
  'comandos',
  'não entendi',
  'nao entendi',
  'e agora',
] as const;

// ──────────────────────────────────────────────
// Balance / Summary
// ──────────────────────────────────────────────
export const BALANCE_KEYWORDS = [
  'saldo',
  'extrato',
  'balanço',
  'balanco',
  'sobro quanto',
  'sobrou quanto',
  'tem dinheiro',
  'posso gastar',
  'meu saldo',
  'saldo atual',
  'quanto tenho',
  'balanço geral',
  'balanco geral',
  'meu balanço',
  'meu balanco',
  'sobrou',
  'quanto sobrou',
  'to devendo',
  'tô devendo',
] as const;

// ──────────────────────────────────────────────
// Monthly Summary
// ──────────────────────────────────────────────
export const MONTHLY_SUMMARY_KEYWORDS = [
  'resumo do mês',
  'resumo do mes',
  'resumo mensal',
  'resumo de',
  'resumo',
  'gastos do mês',
  'gastos do mes',
  'gastos de',
  'quanto gastei',
  'quanto recebi',
  'total gasto',
  'total recebido',
  'como estou no mês',
  'como estou no mes',
  'como estão minhas finanças',
  'como estao minhas financas',
  'meu mês',
  'meu mes',
  'como estou',
  'como to',
  'como tô',
  'situacao do mes',
  'situação do mês',
] as const;

// ──────────────────────────────────────────────
// Category Breakdown
// ──────────────────────────────────────────────
export const CATEGORY_BREAKDOWN_KEYWORDS = [
  'gastos por categoria',
  'resumo por categoria',
  'análise por categoria',
  'analise por categoria',
  'categorias do mês',
  'categorias do mes',
  'quanto gastei em',
  'quanto gastei de',
  'quanto gastei com',
  'onde mais gastei',
  'onde gasto mais',
  'maiores gastos',
  'principais gastos',
  'detalhamento por categoria',
  'gastos por tipo',
  'gastei em que',
  'gastei mais em que',
  'em que gastei',
  'por categoria',
] as const;

// ──────────────────────────────────────────────
// List transactions
// ──────────────────────────────────────────────
export const LIST_TRANSACTIONS_KEYWORDS = [
  'minhas transações',
  'minhas transacoes',
  'meus gastos',
  'minhas receitas',
  'listar transações',
  'listar transacoes',
  'listar gastos',
  'listar receitas',
  'ver transações',
  'ver transacoes',
  'ver gastos',
  'ver receitas',
  'mostrar transações',
  'mostrar transacoes',
  'mostrar gastos',
  'mostrar receitas',
  'histórico',
  'historico',
  'transacoes',
  'transacao',
  'gastos recentes',
  'ultimos gastos',
  'ultimas transacoes',
  'extrato de gastos',
] as const;

// ──────────────────────────────────────────────
// List pending (CONFIRMATION)
// ──────────────────────────────────────────────
export const LIST_PENDING_CONFIRMATION_KEYWORDS = [
  'pendente de confirmação',
  'pendentes de confirmação',
  'pendência de confirmação',
  'pendências de confirmação',
  'aguardando confirmação',
  'falta confirmar',
  'precisa confirmar',
  'confirmar transação',
  'transações para confirmar',
  'transações pendentes de confirmação',
  'o que está aguardando confirmação',
  'o que precisa confirmar',
  'minhas confirmações pendentes',
] as const;

// ──────────────────────────────────────────────
// List pending (PAYMENT)
// ──────────────────────────────────────────────
export const LIST_PENDING_PAYMENT_KEYWORDS = [
  'contas pendentes',
  'contas a pagar',
  'contas abertas',
  'contas em aberto',
  'pagar pendentes',
  'ver pendentes',
  'mostrar pendentes',
  'listar pendentes',
  'lista pendentes',
  'transações pendentes',
  'transacoes pendentes',
  'pagamentos pendentes',
  'pendentes de pagamento',
  'pendências de pagamento',
  'o que tenho que pagar',
  'o que tenho pra pagar',
  'o que preciso pagar',
  'o que falta pagar',
  'minhas contas',
  'minhas dívidas',
  'dívidas pendentes',
  'boletos pendentes',
  'faturas pendentes',
  'pendentes de recebimento',
  'pendências de recebimento',
  'o que tenho que receber',
  'o que tenho pra receber',
  'o que preciso receber',
  'o que falta receber',
] as const;

/** Standalone words that count as "pending payment" */
export const PENDING_STANDALONE_WORDS = ['pendentes', 'pendente', 'pendências'] as const;

// ──────────────────────────────────────────────
// Accounts
// ──────────────────────────────────────────────
export const SWITCH_ACCOUNT_KEYWORDS = [
  'mudar perfil',
  'trocar perfil',
  'mudar de perfil',
  'trocar de perfil',
  'alterar perfil',
  'usar perfil',
  'usar empresa',
  'usar pessoal',
  'selecionar perfil',
  'escolher perfil',
  'ativar perfil',
] as const;

export const LIST_ACCOUNTS_KEYWORDS = [
  'meu perfil',
  'meus perfis',
  'listar perfil',
  'mostrar perfil',
  'ver perfil',
  'quais perfil',
  'todas perfil',
  'lista de perfil',
  'lista perfil',
  'listar perfil',
] as const;

export const SHOW_ACTIVE_ACCOUNT_KEYWORDS = [
  '/conta',
  'meu perfil',
  'perfil',
  'perfil atual',
  'conta ativa',
  'conta atual',
  'qual conta',
  'qual é minha conta',
  'minha conta',
  'conta em uso',
] as const;

// ──────────────────────────────────────────────
// Pay bill
// ──────────────────────────────────────────────
export const PAY_BILL_KEYWORDS = [
  'pagar fatura',
  'pagar conta',
  'quitar fatura',
  'quitar conta',
  'pagamento de fatura',
  'pagamento da fatura',
  'pagar cartão',
  'quitar cartão',
] as const;

// ──────────────────────────────────────────────
// Credit cards
// ──────────────────────────────────────────────
export const LIST_CREDIT_CARDS_KEYWORDS = [
  'meus cartões',
  'meus cartoes',
  'listar cartões',
  'listar cartoes',
  'ver cartões',
  'ver cartoes',
  'mostrar cartões',
  'mostrar cartoes',
  'quais cartões',
  'quais cartoes',
  'cartões de crédito',
  'cartoes de credito',
  'lista de cartões',
  'lista de cartoes',
] as const;

export const SET_DEFAULT_CARD_KEYWORDS = [
  'usar cartao',
  'usar cartão',
  'definir cartao',
  'definir cartão',
  'trocar cartao',
  'trocar cartão',
  'mudar cartao',
  'mudar cartão',
  'cartao padrao',
  'cartão padrão',
  'cartao default',
  'cartão default',
] as const;

export const SHOW_DEFAULT_CARD_KEYWORDS = [
  'qual cartao',
  'qual cartão',
  'cartao atual',
  'cartão atual',
  'cartao ativo',
  'cartão ativo',
  'cartao padrao',
  'cartão padrão',
  'meu cartao',
  'meu cartão',
] as const;

/** Words that disqualify "show default card" (redirect to set/pay) */
export const SHOW_DEFAULT_CARD_EXCLUSIONS = ['pagar', 'usar', 'trocar'] as const;

// ──────────────────────────────────────────────
// Invoices
// ──────────────────────────────────────────────
export const LIST_INVOICES_KEYWORDS = [
  'minhas faturas',
  'listar faturas',
  'ver faturas',
  'mostrar faturas',
  'faturas do cartão',
  'faturas do cartao',
  'fatura do cartão',
  'fatura do cartao',
  'fatura pendente',
  'faturas pendentes',
  'quanto tenho de cartão',
  'quanto tenho de cartao',
  'quanto devo no cartão',
  'quanto devo no cartao',
  'minha fatura',
  'quanto é a fatura',
  'quanto é minha fatura',
] as const;

export const INVOICE_DETAILS_KEYWORDS = [
  'detalhes da fatura',
  'ver fatura',
  'listar fatura',
  'faturas',
  'mostrar fatura',
  'o que tem na fatura',
  'o que tem dentro da fatura',
  'itens da fatura',
  'gastos da fatura',
] as const;

export const PAY_INVOICE_KEYWORDS = [
  'pagar invoice',
  'quitar invoice',
  'pagar fatura de cartão',
  'pagar fatura de cartao',
  'quitar fatura de cartão',
  'quitar fatura de cartao',
  'pagar fatura do cartão',
  'pagar fatura do cartao',
] as const;

/** Generic invoice keywords for "by card name" detection */
export const INVOICE_TRIGGER_KEYWORDS = ['fatura', 'faturas'] as const;

/** Patterns that indicate a generic list rather than "by card name" */
export const INVOICE_GENERIC_LIST_KEYWORDS = [
  'minhas faturas',
  'listar faturas',
  'todas as faturas',
] as const;

// ──────────────────────────────────────────────
// Transaction analysis (scoring)
// ──────────────────────────────────────────────
export const TRANSACTION_VERBS = [
  'gastei',
  'paguei',
  'comprei',
  'comi',
  'recebi',
  'ganhei',
  'vendi',
  'transferi',
  'depositei',
  'saquei',
  'gastar',
  'pagar',
  'comprar',
  'receber',
  'ganhar',
  'vender',
] as const;

export const CATEGORY_KEYWORDS = [
  'mercado',
  'padaria',
  'supermercado',
  'alimentação',
  'comida',
  'restaurante',
  'transporte',
  'uber',
  '99',
  'taxi',
  'gasolina',
  'combustível',
  'luz',
  'água',
  'internet',
  'telefone',
  'aluguel',
  'farmácia',
  'medicamento',
  'médico',
  'saúde',
  'academia',
  'lazer',
  'cinema',
  'salário',
  'freelance',
  'venda',
  'cartão',
  'rotativo',
  'crédito',
  'débito',
  'parcelado',
  'à vista',
  'avista',
] as const;

export const TIME_INDICATORS = [
  'ontem',
  'hoje',
  'anteontem',
  'semana passada',
  'mês passado',
  'agora',
] as const;

// ──────────────────────────────────────────────
// Abbreviation map (slang → expanded form)
// Applied before keyword matching
// ──────────────────────────────────────────────
export const ABBREVIATION_MAP: Record<string, string> = {
  trans: 'transacoes',
  trx: 'transacoes',
  transacao: 'transacoes',
  cat: 'por categoria',
  cc: 'cartao de credito',
  faturas: 'minhas faturas',
};

// ──────────────────────────────────────────────
// Chart generation
// ──────────────────────────────────────────────
export const GENERATE_CHART_KEYWORDS = [
  'gráfico',
  'grafico',
  'gerar gráfico',
  'gerar grafico',
  'mostra gráfico',
  'mostra grafico',
  'ver gráfico',
  'ver grafico',
  'gráfico de categorias',
  'grafico de categorias',
  'gráfico mensal',
  'grafico mensal',
  'gráfico do mês',
  'grafico do mes',
  'imagem dos gastos',
  'chart',
  'mostra imagem',
  'ver imagem dos gastos',
  'visão geral em imagem',
  'visao geral em imagem',
] as const;
