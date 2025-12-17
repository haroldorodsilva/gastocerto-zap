import { dockStart } from '@nlpjs/basic';

/**
 * Intenções predefinidas com suas variações
 */
export interface IntentPattern {
  intent: string;
  patterns: string[];
  threshold?: number; // Similaridade mínima (0-1), padrão: 0.6
}

/**
 * Resultado da análise de intenção
 */
export interface IntentMatch {
  intent: string;
  confidence: number; // 0-1
  matched: boolean;
  matchedPattern?: string;
}

/**
 * Utilitário para detectar intenção do usuário usando NLP (Natural Language Processing)
 * Usa nlp.js com suporte a português para classificação de intenções
 */
export class IntentMatcher {
  private static readonly DEFAULT_THRESHOLD = 0.6;
  private static nlpManager: any = null;
  private static initialized = false;
  private static trainedIntents: string = '';

  /**
   * Inicializa e treina o NLP Manager com os padrões de intenção
   */
  private static async initialize(intents: IntentPattern[]): Promise<void> {
    // Gera hash dos intents para detectar mudanças
    const intentsHash = JSON.stringify(intents.map((i) => i.intent).sort());

    // Reinicializa apenas se os intents mudarem
    if (this.initialized && this.trainedIntents === intentsHash) {
      console.log('[IntentMatcher] Usando modelo já treinado');
      return;
    }

    console.log('[IntentMatcher] Inicializando NLP Manager...');
    const dock = await dockStart({
      use: ['Basic', 'LangPt'],
      settings: {
        nlp: {
          autoSave: false, // Não salvar modelo em arquivo
          autoLoad: false, // Não carregar modelo de arquivo
        },
      },
    });

    this.nlpManager = dock.get('nlp');
    this.nlpManager.addLanguage('pt');

    // Treina o modelo com todos os padrões
    let totalPatterns = 0;
    for (const intentPattern of intents) {
      for (const pattern of intentPattern.patterns) {
        this.nlpManager.addDocument('pt', pattern, intentPattern.intent);
        totalPatterns++;
      }
    }

    console.log(
      `[IntentMatcher] Treinando modelo com ${totalPatterns} padrões de ${intents.length} intents...`,
    );
    await this.nlpManager.train();
    console.log('[IntentMatcher] Treinamento concluído!');

    this.initialized = true;
    this.trainedIntents = intentsHash;
  }

  /**
   * Analisa mensagem do usuário e retorna a intenção mais provável
   */
  static async matchIntent(message: string, intents: IntentPattern[]): Promise<IntentMatch> {
    // Inicializa o NLP se necessário
    await this.initialize(intents);

    // Processa a mensagem usando NLP
    console.log(`[IntentMatcher] Processando: "${message}"`);
    const response = await this.nlpManager.process('pt', message);
    console.log(`[IntentMatcher] Resposta NLP:`, {
      intent: response.intent,
      score: response.score,
      classifications: response.classifications?.slice(0, 3),
    });

    // Encontra o intent pattern para pegar threshold customizado
    const intentPattern = intents.find((i) => i.intent === response.intent);
    const threshold = intentPattern?.threshold ?? this.DEFAULT_THRESHOLD;

    // Encontra o padrão que melhor combinou
    let matchedPattern: string | undefined;
    if (intentPattern && response.score > 0) {
      matchedPattern = intentPattern.patterns[0]; // Usa o primeiro como referência
    }

    return {
      intent: response.intent || 'unknown',
      confidence: response.score || 0,
      matched: (response.score || 0) >= threshold,
      matchedPattern,
    };
  }

  /**
   * Verifica se mensagem corresponde a alguma das intenções
   */
  static async hasIntent(message: string, intents: IntentPattern[]): Promise<boolean> {
    const match = await this.matchIntent(message, intents);
    return match.matched;
  }

  /**
   * Verifica se mensagem corresponde a uma intenção específica
   */
  static async isIntent(
    message: string,
    intentName: string,
    intents: IntentPattern[],
  ): Promise<boolean> {
    const match = await this.matchIntent(message, intents);
    return match.matched && match.intent === intentName;
  }

  /**
   * Reseta o NLP Manager (útil para testes ou retraining)
   */
  static reset(): void {
    this.nlpManager = null;
    this.initialized = false;
    this.trainedIntents = '';
  }
}
