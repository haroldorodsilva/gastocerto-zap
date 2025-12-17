import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@core/database/prisma.service';

/**
 * Resultado da análise de intenção
 */
export interface IntentAnalysisResult {
  intent: MessageIntent;
  confidence: number; // 0-1
  shouldProcess: boolean; // Se deve processar com IA
  suggestedResponse?: string; // Mensagem de sugestão caso não deva processar
  metadata?: any;
}

/**
 * Tipos de intenção identificados
 */
export enum MessageIntent {
  REGISTER_TRANSACTION = 'REGISTER_TRANSACTION', // Registrar transação (despesa/receita)
  CONFIRMATION_RESPONSE = 'CONFIRMATION_RESPONSE', // Responder sim/não para confirmação
  LIST_PENDING = 'LIST_PENDING', // Listar transações pendentes de confirmação
  LIST_PENDING_PAYMENTS = 'LIST_PENDING_PAYMENTS', // Listar contas pendentes de pagamento
  CHECK_BALANCE = 'CHECK_BALANCE', // Consultar saldo
  LIST_TRANSACTIONS = 'LIST_TRANSACTIONS', // Listar transações
  SWITCH_ACCOUNT = 'SWITCH_ACCOUNT', // Trocar conta ativa
  LIST_ACCOUNTS = 'LIST_ACCOUNTS', // Listar todas as contas
  SHOW_ACTIVE_ACCOUNT = 'SHOW_ACTIVE_ACCOUNT', // Mostrar conta ativa
  PAY_BILL = 'PAY_BILL', // Pagar fatura/conta
  HELP = 'HELP', // Pedir ajuda
  GREETING = 'GREETING', // Saudação
  UNKNOWN = 'UNKNOWN', // Não reconhecido
  IRRELEVANT = 'IRRELEVANT', // Irrelevante (conversa casual)
}

@Injectable()
export class IntentAnalyzerService {
  private readonly logger = new Logger(IntentAnalyzerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Analisa a intenção da mensagem usando NLP baseado em regras
   */
  async analyzeIntent(
    text: string,
    phoneNumber: string,
    userCacheId?: string,
  ): Promise<IntentAnalysisResult> {
    const normalizedText = text.toLowerCase().trim();

    this.logger.log(`\n🧠 ========== ANÁLISE DE INTENÇÃO NLP ==========`);
    this.logger.log(`📱 Phone: ${phoneNumber}`);
    this.logger.log(`💬 Text: "${text}"`);

    // 1. Verificar saudações
    if (this.isGreeting(normalizedText)) {
      this.logger.log(`✅ Intent: GREETING (confidence: 0.95)`);
      return {
        intent: MessageIntent.GREETING,
        confidence: 0.95,
        shouldProcess: false,
        suggestedResponse:
          '👋 Olá! Sou o GastoCerto, seu assistente financeiro.\n\n' +
          '💡 *Como posso ajudar?*\n\n' +
          '💸 Para registrar gastos:\n' +
          '   • "Gastei 50 no mercado"\n' +
          '   • "Paguei 30 reais de uber"\n\n' +
          '💰 Para registrar receitas:\n' +
          '   • "Recebi 1000 de salário"\n' +
          '   • "Ganhei 200 de freelance"\n\n' +
          '📷 Também aceito fotos de notas fiscais e áudios!\n\n' +
          'Digite "ajuda" caso precise de mais informações!',
      };
    }

    // 2. Verificar respostas de confirmação (sim/não)
    if (this.isConfirmationResponse(normalizedText)) {
      this.logger.log(`✅ Intent: CONFIRMATION_RESPONSE (confidence: 0.98)`);
      return {
        intent: MessageIntent.CONFIRMATION_RESPONSE,
        confidence: 0.98,
        shouldProcess: true, // Precisa processar a confirmação
        metadata: {
          response: normalizedText,
        },
      };
    }

    // 3. Verificar troca de conta
    if (this.isSwitchAccountRequest(normalizedText)) {
      this.logger.log(`✅ Intent: SWITCH_ACCOUNT (confidence: 0.95)`);
      return {
        intent: MessageIntent.SWITCH_ACCOUNT,
        confidence: 0.95,
        shouldProcess: true,
      };
    }

    // 4. Verificar listagem de contas
    if (this.isListAccountsRequest(normalizedText)) {
      this.logger.log(`✅ Intent: LIST_ACCOUNTS (confidence: 0.95)`);
      return {
        intent: MessageIntent.LIST_ACCOUNTS,
        confidence: 0.95,
        shouldProcess: true,
      };
    }

    // 5. Verificar mostrar conta ativa
    if (this.isShowActiveAccountRequest(normalizedText)) {
      this.logger.log(`✅ Intent: SHOW_ACTIVE_ACCOUNT (confidence: 0.95)`);
      return {
        intent: MessageIntent.SHOW_ACTIVE_ACCOUNT,
        confidence: 0.95,
        shouldProcess: true,
      };
    }

    // 6. Verificar pagamento de fatura/conta
    if (this.isPayBillRequest(normalizedText)) {
      this.logger.log(`✅ Intent: PAY_BILL (confidence: 0.90)`);
      return {
        intent: MessageIntent.PAY_BILL,
        confidence: 0.9,
        shouldProcess: true,
      };
    }

    // 7. Verificar listagem de pendentes de CONFIRMAÇÃO
    if (this.isListPendingRequest(normalizedText)) {
      this.logger.log(`✅ Intent: LIST_PENDING (confidence: 0.95)`);
      return {
        intent: MessageIntent.LIST_PENDING,
        confidence: 0.95,
        shouldProcess: true, // Precisa processar para listar
      };
    }

    // 7.1. Verificar listagem de pendentes de PAGAMENTO
    if (this.isListPendingPaymentsRequest(normalizedText)) {
      this.logger.log(`✅ Intent: LIST_PENDING_PAYMENTS (confidence: 0.95)`);
      return {
        intent: MessageIntent.LIST_PENDING_PAYMENTS,
        confidence: 0.95,
        shouldProcess: true, // Precisa processar para listar
      };
    }

    // 8. Verificar pedidos de ajuda
    if (this.isHelpRequest(normalizedText)) {
      this.logger.log(`✅ Intent: HELP (confidence: 0.95)`);
      return {
        intent: MessageIntent.HELP,
        confidence: 0.95,
        shouldProcess: false,
        suggestedResponse: this.getHelpMessage(),
      };
    }

    // 9. Verificar consultas de saldo/extrato
    if (this.isBalanceCheck(normalizedText)) {
      this.logger.log(`✅ Intent: CHECK_BALANCE (confidence: 0.90)`);
      return {
        intent: MessageIntent.CHECK_BALANCE,
        confidence: 0.9,
        shouldProcess: true, // ✅ AGORA PROCESSA para buscar saldo real
      };
    }

    // 9.1. Verificar listagem de transações
    if (this.isListTransactions(normalizedText)) {
      this.logger.log(`✅ Intent: LIST_TRANSACTIONS (confidence: 0.90)`);
      return {
        intent: MessageIntent.LIST_TRANSACTIONS,
        confidence: 0.9,
        shouldProcess: true, // ✅ PROCESSA para listar transações
      };
    }

    // 10. Verificar intenção de registro de transação (PRINCIPAL)
    const transactionAnalysis = this.analyzeTransactionIntent(normalizedText);
    if (transactionAnalysis.isTransaction) {
      this.logger.log(
        `✅ Intent: REGISTER_TRANSACTION (confidence: ${transactionAnalysis.confidence})`,
      );
      this.logger.log(`   Indicators found: ${transactionAnalysis.indicators.join(', ')}`);
      this.logger.log(`================================================\n`);
      return {
        intent: MessageIntent.REGISTER_TRANSACTION,
        confidence: transactionAnalysis.confidence,
        shouldProcess: true,
        metadata: {
          indicators: transactionAnalysis.indicators,
          hasAmount: transactionAnalysis.hasAmount,
          hasCategory: transactionAnalysis.hasCategory,
        },
      };
    }

    // 11. Mensagem irrelevante/não reconhecida
    this.logger.warn(
      `⚠️  Intent: UNKNOWN/IRRELEVANT (confidence: ${transactionAnalysis.confidence})`,
    );
    this.logger.log(`================================================\n`);

    // Registrar mensagem não reconhecida para análise futura
    await this.logUnrecognizedMessage(
      text,
      phoneNumber,
      userCacheId,
      transactionAnalysis.confidence,
    );

    return {
      intent: MessageIntent.UNKNOWN,
      confidence: transactionAnalysis.confidence,
      shouldProcess: false,
      suggestedResponse:
        '❓ *Não entendi sua mensagem*\n\n' +
        'Sou especializado em ajudar você a registrar suas *despesas* e *receitas*.\n\n' +
        '💡 *Exemplos do que posso fazer:*\n\n' +
        '💸 *Registrar gastos:*\n' +
        '   • "Gastei 50 no mercado"\n' +
        '   • "Paguei 30 reais de uber"\n' +
        '   • "Comprei um café de 5,50"\n\n' +
        '💰 *Registrar receitas:*\n' +
        '   • "Recebi 1000 de salário"\n' +
        '   • "Ganhei 200 de freelance"\n\n' +
        '📷 *Envie foto da nota fiscal*\n' +
        '🎤 *Grave um áudio descrevendo*\n\n' +
        'Tente reformular sua mensagem seguindo esses exemplos!',
    };
  }

  /**
   * Analisa se a mensagem tem intenção de registrar transação
   */
  private analyzeTransactionIntent(text: string): {
    isTransaction: boolean;
    confidence: number;
    indicators: string[];
    hasAmount: boolean;
    hasCategory: boolean;
  } {
    const indicators: string[] = [];
    let score = 0;

    // Palavras-chave de transação (verbos de ação financeira)
    const transactionVerbs = [
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
    ];

    for (const verb of transactionVerbs) {
      if (text.includes(verb)) {
        indicators.push(`verb:${verb}`);
        score += 0.35;
        break; // Contar apenas uma vez
      }
    }

    // Detectar valores monetários (R$, reais, centavos)
    const hasAmount =
      /r\$\s*\d+/.test(text) || // R$ 50
      /\d+\s*reais?/.test(text) || // 50 reais / 50 real
      /\d+[,\.]\d{2}/.test(text) || // 50.00 ou 50,00
      /\d+\s*e\s*\d+/.test(text) || // 50 e 50 centavos
      /\b\d{1,6}\b/.test(text); // Número solto (ex: "gastei 11")

    if (hasAmount) {
      indicators.push('amount');
      score += 0.4;
    }

    // Palavras-chave de categorias comuns
    const categoryKeywords = [
      'mercado',
      'pararia',
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
    ];

    let hasCategory = false;
    for (const keyword of categoryKeywords) {
      if (text.includes(keyword)) {
        indicators.push(`category:${keyword}`);
        score += 0.15;
        hasCategory = true;
        break;
      }
    }

    // Preposições indicando local/categoria ("no", "na", "de", "em")
    if (/\s(no|na|de|em|com)\s/.test(text)) {
      indicators.push('preposition');
      score += 0.1;
    }

    // Indicadores temporais (ontem, hoje, anteontem, semana passada)
    const timeIndicators = ['ontem', 'hoje', 'anteontem', 'semana passada', 'mês passado', 'agora'];
    for (const time of timeIndicators) {
      if (text.includes(time)) {
        indicators.push(`time:${time}`);
        score += 0.1;
        break;
      }
    }

    const isTransaction = score >= 0.5; // Threshold: 50%
    const confidence = Math.min(score, 1.0);

    return {
      isTransaction,
      confidence,
      indicators,
      hasAmount,
      hasCategory,
    };
  }

  /**
   * Verifica se é uma saudação
   */
  private isGreeting(text: string): boolean {
    const greetings = [
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
      'fala aí',
    ];
    return greetings.some((g) => text === g || text.startsWith(g + ' '));
  }

  /**
   * Verifica se é um pedido de ajuda
   */
  private isHelpRequest(text: string): boolean {
    const helpKeywords = [
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
    ];
    return helpKeywords.some((k) => text.includes(k));
  }

  /**
   * Verifica se é consulta de saldo/extrato
   */
  private isBalanceCheck(text: string): boolean {
    const balanceKeywords = [
      'saldo',
      'extrato',
      'quanto gastei',
      'quanto recebi',
      'resumo',
      'balanço',
      'sobro quanto',
      'sobrou quanto',
      'tem dinheiro',
      'posso gastar',
      'meu saldo',
      'saldo atual',
      'quanto tenho',
      'total gasto',
      'total recebido',
    ];
    return balanceKeywords.some((k) => text.includes(k));
  }

  /**
   * Verifica se é listagem de transações
   */
  private isListTransactions(text: string): boolean {
    const listKeywords = [
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
    ];
    return listKeywords.some((k) => text.includes(k));
  }

  /**
   * Verifica se é resposta de confirmação (sim/não)
   */
  private isConfirmationResponse(text: string): boolean {
    // Respostas positivas
    const yesResponses = [
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
    ];

    // Respostas negativas
    const noResponses = [
      'não',
      'nao',
      'n',
      'no',
      'cancelar',
      'cancela',
      'não quero',
      'nao quero',
      'errado',
      'errado',
      'deixa',
      'deixa',
    ];

    // Verifica se é uma resposta curta e direta (até 3 palavras)
    const words = text.trim().split(/\s+/);
    if (words.length > 3) {
      return false; // Mensagens longas não são confirmações simples
    }

    return (
      yesResponses.some((r) => text === r || text.startsWith(r + ' ')) ||
      noResponses.some((r) => text === r || text.startsWith(r + ' '))
    );
  }

  /**
   * Verifica se é pedido para listar pendentes de CONFIRMAÇÃO
   */
  private isListPendingRequest(text: string): boolean {
    const listPendingKeywords = [
      'pendente de confirmação',
      'pendentes de confirmação',
      'aguardando confirmação',
      'falta confirmar',
      'confirmar transação',
      'transações para confirmar',
    ];
    return listPendingKeywords.some((k) => text.includes(k));
  }

  /**
   * Verifica se é pedido para listar pendentes de PAGAMENTO
   */
  private isListPendingPaymentsRequest(text: string): boolean {
    const listPendingPaymentsKeywords = [
      'pendente',
      'pendentes',
      'contas pendentes',
      'contas a pagar',
      'pagar pendentes',
      'ver pendentes',
      'mostrar pendentes',
      'listar pendentes',
      'lista pendentes',
      'pagamentos pendentes',
      'o que tenho que pagar',
      'o que tenho pra pagar',
      'o que falta pagar',
      'contas em aberto',
      'minhas contas',
    ];
    return listPendingPaymentsKeywords.some((k) => text.includes(k));
  }

  /**
   * Retorna mensagem de ajuda
   */
  private getHelpMessage(): string {
    return (
      '📖 *Guia de Uso - GastoCerto*\n\n' +
      '💸 *Registrar Gastos:*\n' +
      '   • "Gastei 50 no mercado"\n' +
      '   • "Paguei 30 reais de uber"\n' +
      '   • "Comprei café de 5,50"\n\n' +
      '💰 *Registrar Receitas:*\n' +
      '   • "Recebi 1000 de salário"\n' +
      '   • "Ganhei 200 de freelance"\n\n' +
      '🏦 *Gerenciar Perfil:*\n' +
      '   • "Meus perfis" - Ver todas os perfis\n' +
      '   • "Mudar Perfil" - Trocar perfil\n' +
      '   • "Perfil" ou "meu perfil" - Ver conta atual\n' +
      '   • "Usar Pessoal" - Trocar diretamente para Pessoal\n\n' +
      '💳 *Pagamentos:*\n' +
      '   • "Pagar fatura" - Pagar fatura do cartão\n' +
      '   • "Quitar conta" - Marcar conta como paga\n\n' +
      '📷 *Nota Fiscal:*\n' +
      '   • Tire uma foto e envie\n' +
      '   • Detectamos valores automaticamente\n\n' +
      '🎤 *Áudio:*\n' +
      '   • Grave descrevendo a transação\n' +
      '   • Ex: "Gastei 40 reais no posto"\n\n' +
      '💡 *Dicas:*\n' +
      '   • Seja específico com valores\n' +
      '   • Mencione a categoria (mercado, transporte, etc)\n' +
      '   • Use linguagem natural e simples'
    );
  }

  /**
   * Verifica se é uma solicitação de troca de conta
   */
  private isSwitchAccountRequest(text: string): boolean {
    const switchAccountKeywords = [
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
    ];

    // Verificar padrões diretos
    if (switchAccountKeywords.some((k) => text.includes(k))) {
      return true;
    }

    // Verificar padrão "usar [nome da conta]"
    if (text.startsWith('usar ') && text.split(' ').length >= 2) {
      return true;
    }

    return false;
  }

  /**
   * Verifica se é uma solicitação de listagem de contas
   */
  private isListAccountsRequest(text: string): boolean {
    const listAccountsKeywords = [
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
    ];
    return listAccountsKeywords.some((k) => text.includes(k));
  }

  /**
   * Verifica se é uma solicitação para mostrar conta ativa
   */
  private isShowActiveAccountRequest(text: string): boolean {
    const showActiveKeywords = [
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
    ];
    return showActiveKeywords.some((k) => text.includes(k));
  }

  /**
   * Verifica se é uma solicitação de pagamento de fatura/conta
   */
  private isPayBillRequest(text: string): boolean {
    const payBillKeywords = [
      'pagar fatura',
      'pagar conta',
      'quitar fatura',
      'quitar conta',
      'pagamento de fatura',
      'pagamento da fatura',
      'pagar cartão',
      'quitar cartão',
    ];
    return payBillKeywords.some((k) => text.includes(k));
  }

  /**
   * Registra mensagem não reconhecida para análise futura
   */
  private async logUnrecognizedMessage(
    text: string,
    phoneNumber: string,
    userCacheId: string | undefined,
    confidence: number,
  ): Promise<void> {
    try {
      await this.prisma.unrecognizedMessage.create({
        data: {
          userCacheId,
          phoneNumber,
          messageText: text,
          detectedIntent: MessageIntent.UNKNOWN,
          confidence,
          metadata: {
            timestamp: new Date().toISOString(),
            textLength: text.length,
          },
        },
      });

      this.logger.log(`📝 Mensagem não reconhecida registrada para análise`);
    } catch (error) {
      this.logger.error('Erro ao registrar mensagem não reconhecida:', error);
    }
  }

  /**
   * Busca mensagens não reconhecidas para análise e treinamento
   */
  async getUnrecognizedMessages(limit: number = 100): Promise<any[]> {
    return this.prisma.unrecognizedMessage.findMany({
      where: {
        addedToContext: false,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: limit,
    });
  }

  /**
   * Marca mensagem como adicionada ao contexto de treinamento
   */
  async markAsAddedToContext(messageId: string): Promise<void> {
    await this.prisma.unrecognizedMessage.update({
      where: { id: messageId },
      data: { addedToContext: true },
    });
  }
}
