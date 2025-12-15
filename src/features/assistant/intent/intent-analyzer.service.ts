import { Injectable, Logger } from '@nestjs/common';

export interface IntentResult {
  intent: string;
  confidence: number;
  entities: Record<string, any>;
}

/**
 * IntentAnalyzerService
 * Detecta intenção do usuário com base em padrões
 */
@Injectable()
export class IntentAnalyzerService {
  private readonly logger = new Logger(IntentAnalyzerService.name);

  // Padrões de intenções (keywords + regex)
  private readonly INTENT_PATTERNS = {
    add_transaction: {
      patterns: [
        /gastei|comprei|paguei|despesa|gasto/i,
        /recebi|ganhei|renda|receita|entrada/i,
        /R?\$?\s*\d+/i, // Valor monetário
      ],
      keywords: ['gastei', 'comprei', 'paguei', 'recebi', 'ganhei'],
      minScore: 0.7,
    },
    query_balance: {
      patterns: [
        /quanto|saldo|tenho|disponível|restante/i,
        /balanço|finanças|dinheiro/i,
      ],
      keywords: ['saldo', 'quanto', 'tenho', 'balanço'],
      minScore: 0.6,
    },
    list_transactions: {
      patterns: [
        /lista|mostrar|ver|exibir|visualizar/i,
        /transações|gastos|despesas|receitas/i,
        /histórico|extrato/i,
      ],
      keywords: ['lista', 'mostrar', 'transações', 'histórico', 'extrato'],
      minScore: 0.6,
    },
    process_payment: {
      patterns: [
        /pagar|pagamento|quitar|saldar/i,
        /boleto|fatura|conta|débito/i,
      ],
      keywords: ['pagar', 'pagamento', 'boleto', 'fatura'],
      minScore: 0.7,
    },
    query_summary: {
      patterns: [
        /resumo|relatório|total|consolidado/i,
        /mês|semana|período/i,
      ],
      keywords: ['resumo', 'relatório', 'total', 'consolidado'],
      minScore: 0.6,
    },
    confirm_action: {
      patterns: [
        /^(sim|confirmar|confirmo|ok|okay|certo|exato|correto|isso mesmo)$/i,
        /^s$/i,
      ],
      keywords: ['sim', 'confirmar', 'ok', 'certo'],
      minScore: 0.9,
    },
    cancel_action: {
      patterns: [
        /^(não|nao|cancelar|cancelo|voltar|desistir)$/i,
        /^n$/i,
      ],
      keywords: ['não', 'nao', 'cancelar', 'voltar'],
      minScore: 0.9,
    },
    help: {
      patterns: [
        /ajuda|help|socorro|como|comandos|opções|menu/i,
      ],
      keywords: ['ajuda', 'help', 'como', 'menu'],
      minScore: 0.8,
    },
  };

  /**
   * Detecta intenção do usuário
   */
  async detectIntent(message: string): Promise<IntentResult> {
    const normalizedMessage = message.toLowerCase().trim();

    // Testar cada padrão de intenção
    let bestMatch: IntentResult = {
      intent: 'unknown',
      confidence: 0,
      entities: {},
    };

    for (const [intent, config] of Object.entries(this.INTENT_PATTERNS)) {
      const score = this.calculateScore(normalizedMessage, config);

      if (score > bestMatch.confidence && score >= config.minScore) {
        bestMatch = {
          intent,
          confidence: score,
          entities: this.extractEntities(normalizedMessage, intent),
        };
      }
    }

    this.logger.debug(
      `🎯 Intent: ${bestMatch.intent} (${(bestMatch.confidence * 100).toFixed(1)}%)`,
    );

    return bestMatch;
  }

  /**
   * Alias para detectIntent (compatibilidade)
   */
  async analyzeIntent(message: string): Promise<IntentResult> {
    return this.detectIntent(message);
  }

  /**
   * Calcula score de correspondência
   */
  private calculateScore(
    message: string,
    config: {
      patterns: RegExp[];
      keywords: string[];
      minScore: number;
    },
  ): number {
    let score = 0;
    let matches = 0;

    // Teste de regex patterns
    for (const pattern of config.patterns) {
      if (pattern.test(message)) {
        matches++;
      }
    }

    // Score baseado em patterns (peso 0.6)
    score += (matches / config.patterns.length) * 0.6;

    // Teste de keywords (peso 0.4)
    const keywordMatches = config.keywords.filter((keyword) =>
      message.includes(keyword.toLowerCase()),
    );

    score += (keywordMatches.length / config.keywords.length) * 0.4;

    return Math.min(score, 1); // Normalizar para 0-1
  }

  /**
   * Extrai entidades da mensagem
   */
  private extractEntities(
    message: string,
    intent: string,
  ): Record<string, any> {
    const entities: Record<string, any> = {};

    // Extrair valores monetários
    const moneyMatch = message.match(/R?\$?\s*(\d+(?:[.,]\d{1,2})?)/i);
    if (moneyMatch) {
      entities.amount = parseFloat(moneyMatch[1].replace(',', '.'));
    }

    // Extrair descrição (para transações)
    if (intent === 'add_transaction') {
      // Remove valores e palavras-chave da descrição
      let description = message
        .replace(/R?\$?\s*\d+(?:[.,]\d{1,2})?/gi, '')
        .replace(/gastei|comprei|paguei|recebi|ganhei/gi, '')
        .trim();

      // Detectar preposição "no/na" para melhor contexto
      const descMatch = description.match(/(?:no|na|em|de)\s+(.+)/i);
      if (descMatch) {
        description = descMatch[1];
      }

      entities.description = description || 'sem descrição';
    }

    // Extrair tipo (despesa/receita)
    if (
      /gastei|comprei|paguei|despesa/i.test(message)
    ) {
      entities.type = 'expense';
    } else if (/recebi|ganhei|receita/i.test(message)) {
      entities.type = 'income';
    }

    // Extrair período (para consultas)
    if (intent === 'query_summary' || intent === 'list_transactions') {
      if (/hoje/i.test(message)) {
        entities.period = 'today';
      } else if (/semana/i.test(message)) {
        entities.period = 'week';
      } else if (/mês|mes/i.test(message)) {
        entities.period = 'month';
      }
    }

    return entities;
  }

  /**
   * Lista todas as intenções suportadas
   */
  getSupportedIntents(): string[] {
    return Object.keys(this.INTENT_PATTERNS);
  }

  /**
   * Retorna exemplos de mensagens para cada intenção
   */
  getIntentExamples(intent: string): string[] {
    const examples: Record<string, string[]> = {
      add_transaction: [
        'Gastei 45 no almoço',
        'Comprei R$ 150 de roupas',
        'Recebi 500 de freelance',
      ],
      query_balance: [
        'Quanto eu tenho?',
        'Qual meu saldo?',
        'Quanto tenho disponível?',
      ],
      list_transactions: [
        'Lista minhas transações',
        'Mostrar meus gastos',
        'Ver histórico',
      ],
      process_payment: [
        'Pagar boleto de R$ 200',
        'Quitar fatura',
      ],
      query_summary: [
        'Resumo do mês',
        'Total de gastos',
      ],
      confirm_action: ['Sim', 'Confirmar', 'Ok'],
      cancel_action: ['Não', 'Cancelar'],
      help: ['Ajuda', 'Como funciona?', 'Menu'],
    };

    return examples[intent] || [];
  }
}
