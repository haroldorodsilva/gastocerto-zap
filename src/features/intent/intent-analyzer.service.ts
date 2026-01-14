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
  LIST_CREDIT_CARDS = 'LIST_CREDIT_CARDS', // Listar cartões de crédito
  SET_DEFAULT_CREDIT_CARD = 'SET_DEFAULT_CREDIT_CARD', // Definir cartão padrão
  SHOW_DEFAULT_CREDIT_CARD = 'SHOW_DEFAULT_CREDIT_CARD', // Mostrar cartão padrão
  SHOW_INVOICE_BY_CARD_NAME = 'SHOW_INVOICE_BY_CARD_NAME', // Ver fatura por nome do cartão
  LIST_INVOICES = 'LIST_INVOICES', // Listar faturas de cartão
  SHOW_INVOICE_DETAILS = 'SHOW_INVOICE_DETAILS', // Detalhes de uma fatura
  PAY_INVOICE = 'PAY_INVOICE', // Pagar fatura de cartão (invoice)
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
      const greetingResponse = this.getContextualGreeting(normalizedText);
      return {
        intent: MessageIntent.GREETING,
        confidence: 0.95,
        shouldProcess: false,
        suggestedResponse: greetingResponse,
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

    // 6. Verificar consultas de cartão de crédito
    // 6.1. Listar cartões
    if (this.isListCreditCardsRequest(normalizedText)) {
      this.logger.log(`✅ Intent: LIST_CREDIT_CARDS (confidence: 0.95)`);
      return {
        intent: MessageIntent.LIST_CREDIT_CARDS,
        confidence: 0.95,
        shouldProcess: true,
      };
    }

    // 6.2. Definir cartão padrão
    if (this.isSetDefaultCreditCardRequest(normalizedText)) {
      this.logger.log(`✅ Intent: SET_DEFAULT_CREDIT_CARD (confidence: 0.95)`);
      return {
        intent: MessageIntent.SET_DEFAULT_CREDIT_CARD,
        confidence: 0.95,
        shouldProcess: true,
      };
    }

    // 6.3. Mostrar cartão padrão
    if (this.isShowDefaultCreditCardRequest(normalizedText)) {
      this.logger.log(`✅ Intent: SHOW_DEFAULT_CREDIT_CARD (confidence: 0.95)`);
      return {
        intent: MessageIntent.SHOW_DEFAULT_CREDIT_CARD,
        confidence: 0.95,
        shouldProcess: true,
      };
    }

    // 6.4. Ver fatura por nome do cartão
    if (this.isShowInvoiceByCardNameRequest(normalizedText)) {
      this.logger.log(`✅ Intent: SHOW_INVOICE_BY_CARD_NAME (confidence: 0.95)`);
      return {
        intent: MessageIntent.SHOW_INVOICE_BY_CARD_NAME,
        confidence: 0.95,
        shouldProcess: true,
      };
    }

    // 6.5. Listar faturas de cartão
    if (this.isListInvoicesRequest(normalizedText)) {
      this.logger.log(`✅ Intent: LIST_INVOICES (confidence: 0.95)`);
      return {
        intent: MessageIntent.LIST_INVOICES,
        confidence: 0.95,
        shouldProcess: true,
      };
    }

    // 6.6. Ver detalhes de fatura
    if (this.isShowInvoiceDetailsRequest(normalizedText)) {
      this.logger.log(`✅ Intent: SHOW_INVOICE_DETAILS (confidence: 0.90)`);
      return {
        intent: MessageIntent.SHOW_INVOICE_DETAILS,
        confidence: 0.9,
        shouldProcess: true,
      };
    }

    // 6.7. Pagar fatura de cartão (invoice)
    if (this.isPayInvoiceRequest(normalizedText)) {
      this.logger.log(`✅ Intent: PAY_INVOICE (confidence: 0.90)`);
      return {
        intent: MessageIntent.PAY_INVOICE,
        confidence: 0.9,
        shouldProcess: true,
      };
    }

    // 7. Verificar pagamento de fatura/conta (transação pendente)
    if (this.isPayBillRequest(normalizedText)) {
      this.logger.log(`✅ Intent: PAY_BILL (confidence: 0.90)`);
      return {
        intent: MessageIntent.PAY_BILL,
        confidence: 0.9,
        shouldProcess: true,
      };
    }

    // 7. Verificar listagem de pendentes (com priorização inteligente)
    // IMPORTANTE: Prioridade = Termos específicos > Termos genéricos
    const hasConfirmationKeywords = this.isListPendingRequest(normalizedText);
    const hasPaymentKeywords = this.isListPendingPaymentsRequest(normalizedText);

    // Se detectou palavras de CONFIRMAÇÃO (mais específico), priorizar
    if (hasConfirmationKeywords) {
      this.logger.log(`✅ Intent: LIST_PENDING (confirmações) - confidence: 0.95`);
      return {
        intent: MessageIntent.LIST_PENDING,
        confidence: 0.95,
        shouldProcess: true,
      };
    }

    // Se detectou palavras de PAGAMENTO (genérico), usar como fallback
    if (hasPaymentKeywords) {
      this.logger.log(`✅ Intent: LIST_PENDING_PAYMENTS (pagamentos) - confidence: 0.95`);
      return {
        intent: MessageIntent.LIST_PENDING_PAYMENTS,
        confidence: 0.95,
        shouldProcess: true,
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
    // Usa phoneNumber que é o identificador real da plataforma (chatId do Telegram, número do WhatsApp, etc)
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
        '❓ *Não entendi sua mensagem*\n' +
        'Sou especializado em ajudar você a registrar suas *despesas* e *receitas*.\n\n' +
        '💡 *Exemplos do que posso fazer:*\n\n' +
        '   • "Gastei 50 no mercado"\n' +
        '   • "Recebi 1000 de salário"\n' +
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
    ];
    return greetings.some((g) => text === g || text.startsWith(g + ' '));
  }

  /**
   * Retorna saudação contextual baseada no horário e tipo de saudação
   */
  private getContextualGreeting(text: string): string {
    const hour = new Date().getHours();
    let timeGreeting = '👋 Olá';

    // Detectar período do dia
    if (text.includes('bom dia') || (hour >= 5 && hour < 12)) {
      timeGreeting = '☀️ Bom dia';
    } else if (text.includes('boa tarde') || (hour >= 12 && hour < 18)) {
      timeGreeting = '🌤️ Boa tarde';
    } else if (text.includes('boa noite') || hour >= 18 || hour < 5) {
      timeGreeting = '🌙 Boa noite';
    }

    // Detectar "tudo bem" / "como vai"
    const isAskingHowAreYou =
      text.includes('tudo bem') ||
      text.includes('como vai') ||
      text.includes('como você está') ||
      text.includes('tudo bom') ||
      text.includes('beleza');

    let greeting = `${timeGreeting}! `;

    if (isAskingHowAreYou) {
      greeting += 'Tudo ótimo por aqui! 😊\n\n';
    }

    greeting += 'Sou o *GastoCerto*, seu assistente financeiro pessoal.\n\n';

    // Mensagem principal
    greeting +=
      '💡 *O que posso fazer por você hoje?*\n\n' +
      '💸 *Registrar transações:*\n' +
      '   • "Gastei 50 no mercado"\n' +
      '   • "Recebi 1000 de salário"\n' +
      '📊 *Consultar finanças:*\n' +
      '   • "Meu saldo"\n' +
      '   • "Minhas transações"\n' +
      '   • "Minhas faturas"\n' +
      '   • "Meus cartões"\n' +
      '📷 *Outras formas:*\n' +
      '   • Envie foto de nota fiscal\n' +
      '   • Grave um áudio descrevendo\n\n' +
      '✨ Use linguagem natural! Estou aqui para facilitar sua vida financeira.\n\n' +
      '❓ Digite *"ajuda"* para ver todos os comandos disponíveis.';

    return greeting;
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
   * Palavras-chave ESPECÍFICAS para evitar ambiguidade
   */
  private isListPendingRequest(text: string): boolean {
    const listPendingKeywords = [
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
    ];
    return listPendingKeywords.some((k) => text.includes(k));
  }

  /**
   * Verifica se é pedido para listar pendentes de PAGAMENTO
   * Palavras-chave GENÉRICAS (só usa se não for confirmação)
   *
   * IMPORTANTE: Este método só é chamado se isListPendingRequest() retornar false
   */
  private isListPendingPaymentsRequest(text: string): boolean {
    const listPendingPaymentsKeywords = [
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
    ];

    // Apenas palavra "pendentes" ou "pendente" sozinha também conta como PAGAMENTO
    const hasPendingWord = text === 'pendentes' || text === 'pendente' || text === 'pendências';

    return listPendingPaymentsKeywords.some((k) => text.includes(k)) || hasPendingWord;
  }

  /**
   * Retorna mensagem de ajuda
   */
  private getHelpMessage(): string {
    return (
      '📖 *Guia de Uso - GastoCerto*\n\n' +
      '💸 *Registrar transações:*\n' +
      '   • "Gastei 50 no mercado"\n' +
      '   • "Paguei 30 reais de uber"\n' +
      '   • "Recebi 1000 de salário"\n' +
      '   • "Ganhei 200 de freelance"\n' +
      '💵 *Consultar Finanças:*\n' +
      '   • "Meu saldo" - Ver balanço geral\n' +
      '   • "Minhas transações" - Listar últimas 10\n' +
      '💳 *Cartões de Crédito:*\n' +
      '   • "Meus cartões" - Listar cartões\n' +
      '   • "Minhas faturas" - Ver faturas\n' +
      '📋 *Contas Pendentes:*\n' +
      '   • "Pendentes" - Ver contas a pagar\n' +
      '   • "Ver pendentes" - Listar pendências\n\n' +
      '✅ *Confirmações:*\n' +
      '   • "Pendentes de confirmação" - Ver aguardando\n' +
      '🏦 *Gerenciar Perfil:*\n' +
      '   • "Meus perfis" - Ver todas as contas\n' +
      '   • "Perfil" ou "conta ativa" - Ver conta atual\n' +
      '📷 *Nota Fiscal:*\n' +
      '   • Tire uma foto e envie\n' +
      '   • Detectamos valores automaticamente\n\n' +
      '🎤 *Áudio:*\n' +
      '   • Grave descrevendo a transação\n' +
      '   • Ex: "Gastei 40 reais no posto"\n\n'
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
   * Verifica se é uma solicitação para listar cartões de crédito
   */
  private isListCreditCardsRequest(text: string): boolean {
    const listCardsKeywords = [
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
    ];
    return listCardsKeywords.some((k) => text.includes(k));
  }

  /**
   * Verifica se é uma solicitação para definir cartão padrão
   */
  private isSetDefaultCreditCardRequest(text: string): boolean {
    const setCardKeywords = [
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
    ];
    return setCardKeywords.some((k) => text.includes(k));
  }

  /**
   * Verifica se é uma solicitação para ver cartão padrão
   */
  private isShowDefaultCreditCardRequest(text: string): boolean {
    const showCardKeywords = [
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
    ];
    // Evitar match com "qual cartao pagar" ou "qual cartao usar"
    if (text.includes('pagar') || text.includes('usar') || text.includes('trocar')) {
      return false;
    }
    return showCardKeywords.some((k) => text.includes(k));
  }

  /**
   * Verifica se é uma solicitação para ver fatura por nome do cartão
   * Ex: "ver fatura nubank", "fatura itau", "fatura do inter"
   */
  private isShowInvoiceByCardNameRequest(text: string): boolean {
    const invoiceKeywords = ['fatura', 'faturas'];
    const hasInvoiceKeyword = invoiceKeywords.some((k) => text.includes(k));

    // Verificar se não é comando de lista genérica
    const isGenericList =
      text.includes('minhas faturas') ||
      text.includes('listar faturas') ||
      text.includes('todas as faturas') ||
      /ver fatura \d/.test(text) || // "ver fatura 1"
      /pagar fatura \d/.test(text); // "pagar fatura 1"

    // Se tem "fatura" mas não é lista genérica, pode ser busca por nome
    // Ex: "fatura nubank", "ver fatura itau", "fatura do inter"
    return hasInvoiceKeyword && !isGenericList && text.length > 6;
  }

  /**
   * Verifica se é uma solicitação para listar faturas de cartão
   */
  private isListInvoicesRequest(text: string): boolean {
    const listInvoicesKeywords = [
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
    ];
    return listInvoicesKeywords.some((k) => text.includes(k));
  }

  /**
   * Verifica se é uma solicitação para ver detalhes de uma fatura
   */
  private isShowInvoiceDetailsRequest(text: string): boolean {
    const invoiceDetailsKeywords = [
      'detalhes da fatura',
      'ver fatura',
      'listar fatura',
      'faturas',
      'mostrar fatura',
      'o que tem na fatura',
      'o que tem dentro da fatura',
      'itens da fatura',
      'gastos da fatura',
    ];
    return invoiceDetailsKeywords.some((k) => text.includes(k));
  }

  /**
   * Verifica se é uma solicitação para pagar fatura de cartão (invoice)
   */
  private isPayInvoiceRequest(text: string): boolean {
    const payInvoiceKeywords = [
      'pagar invoice',
      'quitar invoice',
      'pagar fatura de cartão',
      'pagar fatura de cartao',
      'quitar fatura de cartão',
      'quitar fatura de cartao',
      'pagar fatura do cartão',
      'pagar fatura do cartao',
    ];
    return payInvoiceKeywords.some((k) => text.includes(k));
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
