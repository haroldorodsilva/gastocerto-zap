/**
 * Constantes NLP - Palavras-chave para Processamento de Linguagem Natural
 *
 * Centraliza todas as palavras-chave usadas em:
 * - Detecção de intenção
 * - Extração temporal
 * - Limpeza de texto
 * - Classificação de transações
 *
 * ⚠️ IMPORTANTE: Todas as palavras devem estar em LOWERCASE
 */

/**
 * Palavras temporais (expressões de tempo)
 * Usadas para filtrar na detecção de termos e parsing temporal
 */
export const TEMPORAL_WORDS = [
  'ontem',
  'hoje',
  'amanha',
  'amanhã',
  'anteontem',
  'agora',
  'semana',
  'mes',
  'mês',
  'ano',
  'dia',
  'hora',
  'minuto',
] as const;

/**
 * Verbos de transação (ações financeiras)
 * Usados para detecção de intenção e limpeza de descrição
 */
export const TRANSACTION_VERBS = [
  'gastei',
  'comprei',
  'paguei',
  'recebi',
  'ganhei',
  'transferi',
  'depositei',
  'saquei',
  'enviei',
] as const;

/**
 * Palavras-chave que indicam DESPESA (EXPENSES)
 */
export const EXPENSE_KEYWORDS = [
  'gastei',
  'paguei',
  'comprei',
  'compra',
  'despesa',
  'conta',
  'boleto',
  'débito',
  'debito',
  'parcela',
  'prestação',
  'prestacao',
  'mensalidade',
  'taxa',
  'multa',
] as const;

/**
 * Palavras-chave que indicam RECEITA (INCOME)
 */
export const INCOME_KEYWORDS = [
  'recebi',
  'ganhei',
  'salário',
  'salario',
  'recebimento',
  'deposito',
  'depósito',
  'crédito',
  'credito',
  'transferência',
  'transferencia',
  'entrada',
  'renda',
] as const;

/**
 * Preposições comuns em português
 * Usadas para limpeza de descrição
 */
export const PREPOSITIONS = [
  'no',
  'na',
  'em',
  'de',
  'do',
  'da',
  'para',
  'com',
  'sem',
  'sobre',
  'por',
  'pelo',
  'pela',
  'aos',
  'das',
  'dos',
  'nas',
  'nos',
] as const;

/**
 * Artigos (definidos e indefinidos)
 * Usados para limpeza de descrição
 */
export const ARTICLES = ['o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas'] as const;

/**
 * Adjetivos comuns que não agregam à descrição
 * Usados para limpeza de descrição
 */
export const COMMON_ADJECTIVES = [
  'novo',
  'nova',
  'novos',
  'novas',
  'velho',
  'velha',
  'velhos',
  'velhas',
  'usado',
  'usada',
  'usados',
  'usadas',
  'grande',
  'pequeno',
  'pequena',
  'bonito',
  'bonita',
] as const;

/**
 * Estabelecimentos/locais comuns
 * Geralmente já estão na categoria, não precisam na descrição
 */
export const COMMON_ESTABLISHMENTS = [
  'supermercado',
  'mercado',
  'farmácia',
  'farmacia',
  'restaurante',
  'padaria',
  'lanchonete',
  'loja',
  'shopping',
  'feira',
  'pizzaria',
] as const;

/**
 * Combina todas as palavras que devem ser filtradas na detecção de termo desconhecido
 * ⚠️ Removido 'as const' para permitir .includes() funcionar corretamente
 */
export const FILTER_WORDS_FOR_TERM_DETECTION: string[] = [...TEMPORAL_WORDS, ...TRANSACTION_VERBS];

/**
 * Tipo helper para palavras temporais
 */
export type TemporalWord = (typeof TEMPORAL_WORDS)[number];

/**
 * Tipo helper para verbos de transação
 */
export type TransactionVerb = (typeof TRANSACTION_VERBS)[number];

/**
 * Tipo helper para palavras de despesa
 */
export type ExpenseKeyword = (typeof EXPENSE_KEYWORDS)[number];

/**
 * Tipo helper para palavras de receita
 */
export type IncomeKeyword = (typeof INCOME_KEYWORDS)[number];

/**
 * Comandos de WebChat - Perfil/Conta
 */

/**
 * Comandos para visualizar perfil atual (PERMITIDO no WebChat)
 */
export const WEBCHAT_SHOW_PROFILE_COMMANDS = [
  'perfil',
  'qual perfil',
  'perfil atual',
  'meu perfil',
  'qual conta',
  'conta atual',
  'qual o perfil',
  'perfil ativo',
  'conta',
  'conta ativa',
] as const;

/**
 * Comandos de gerenciamento de perfil (BLOQUEADO no WebChat)
 * Usuário deve usar interface gráfica
 */
export const WEBCHAT_MANAGEMENT_COMMANDS = [
  'listar perfis',
  'meus perfis',
  'minhas contas',
  'ver perfis',
  'mudar perfil',
  'trocar perfil',
  'mudar conta',
  'trocar conta',
  'usar perfil',
  'selecionar perfil',
] as const;

/**
 * Tipo helper para comandos de visualização de perfil
 */
export type WebChatShowProfileCommand = (typeof WEBCHAT_SHOW_PROFILE_COMMANDS)[number];

/**
 * Tipo helper para comandos de gerenciamento
 */
export type WebChatManagementCommand = (typeof WEBCHAT_MANAGEMENT_COMMANDS)[number];
