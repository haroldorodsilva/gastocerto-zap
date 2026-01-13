import { IntentPattern } from '@infrastructure/nlp/services/intent-matcher.service';

/**
 * Intenções durante solicitação de código de verificação
 */
export const VERIFICATION_CODE_INTENTS: IntentPattern[] = [
  {
    intent: 'resend_code',
    patterns: [
      'reenviar',
      'reenvia',
      'reenviar codigo',
      'reenviar código',
      'enviar novamente',
      'enviar de novo',
      'mandar de novo',
      'novo codigo',
      'novo código',
      'nao recebi',
      'não recebi',
      'não chegou',
      'nao chegou',
      'cadê o código',
      'cade o codigo',
      'não veio',
      'nao veio',
    ],
    threshold: 0.5, // Mais tolerante
  },
  {
    intent: 'correct_email',
    patterns: [
      'corrigir',
      'corrigir email',
      'corrigir e-mail',
      'mudar email',
      'mudar e-mail',
      'trocar email',
      'trocar e-mail',
      'alterar email',
      'alterar e-mail',
      'email errado',
      'e-mail errado',
      'digitei errado',
      'escrevi errado',
      'voltar',
    ],
    threshold: 0.5,
  },
];

/**
 * Intenções durante confirmação de dados
 */
export const CONFIRMATION_INTENTS: IntentPattern[] = [
  {
    intent: 'confirm',
    patterns: [
      'sim',
      'yes',
      'confirmar',
      'confirmo',
      'está correto',
      'esta correto',
      'correto',
      'certo',
      'ok',
      'okay',
      'tudo certo',
      'pode ser',
      'isso mesmo',
      'exato',
      'afirmativo',
      's',
    ],
    threshold: 0.6,
  },
  {
    intent: 'restart',
    patterns: [
      'nao',
      'não',
      'no',
      'não está correto',
      'nao esta correto',
      'errado',
      'incorreto',
      'recomeçar',
      'recomecar',
      'reiniciar',
      'começar de novo',
      'comecar de novo',
      'corrigir',
      'mudar',
      'alterar',
      'n',
    ],
    threshold: 0.6,
  },
];

/**
 * Intenções durante solicitação de telefone
 */
export const PHONE_REQUEST_INTENTS: IntentPattern[] = [
  {
    intent: 'skip',
    patterns: [
      'pular',
      'skip',
      'passar',
      'próximo',
      'proximo',
      'não quero',
      'nao quero',
      'não vou',
      'nao vou',
      'não precisa',
      'nao precisa',
      'sem telefone',
      'agora não',
      'agora nao',
      'depois',
      'continuar sem',
    ],
    threshold: 0.5,
  },
  {
    intent: 'help',
    patterns: [
      'ajuda',
      'help',
      'como',
      'como funciona',
      'não entendi',
      'nao entendi',
      'não sei',
      'nao sei',
      'o que fazer',
      'explica',
      'como compartilhar',
    ],
    threshold: 0.5,
  },
];

/**
 * Intenções negativas/cancelamento (global)
 */
export const NEGATIVE_INTENTS: IntentPattern[] = [
  {
    intent: 'cancel',
    patterns: [
      'cancelar',
      'cancel',
      'desistir',
      'parar',
      'stop',
      'sair',
      'exit',
      'não quero mais',
      'nao quero mais',
      'esquecer',
      'deixa pra lá',
      'deixa pra la',
    ],
    threshold: 0.6,
  },
  {
    intent: 'restart',
    patterns: [
      'recomeçar',
      'recomecar',
      'reiniciar',
      'restart',
      'começar de novo',
      'comecar de novo',
      'do zero',
      'novo cadastro',
    ],
    threshold: 0.6,
  },
];
