import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@core/database/prisma.service';
import {
  GREETING_KEYWORDS,
  HOW_ARE_YOU_KEYWORDS,
  YES_RESPONSES,
  NO_RESPONSES,
  HELP_KEYWORDS,
  BALANCE_KEYWORDS,
  MONTHLY_SUMMARY_KEYWORDS,
  CATEGORY_BREAKDOWN_KEYWORDS,
  LIST_TRANSACTIONS_KEYWORDS,
  LIST_PENDING_CONFIRMATION_KEYWORDS,
  LIST_PENDING_PAYMENT_KEYWORDS,
  PENDING_STANDALONE_WORDS,
  SWITCH_ACCOUNT_KEYWORDS,
  LIST_ACCOUNTS_KEYWORDS,
  SHOW_ACTIVE_ACCOUNT_KEYWORDS,
  PAY_BILL_KEYWORDS,
  LIST_CREDIT_CARDS_KEYWORDS,
  SET_DEFAULT_CARD_KEYWORDS,
  SHOW_DEFAULT_CARD_KEYWORDS,
  SHOW_DEFAULT_CARD_EXCLUSIONS,
  LIST_INVOICES_KEYWORDS,
  INVOICE_DETAILS_KEYWORDS,
  PAY_INVOICE_KEYWORDS,
  INVOICE_TRIGGER_KEYWORDS,
  INVOICE_GENERIC_LIST_KEYWORDS,
  TRANSACTION_VERBS,
  CATEGORY_KEYWORDS,
  TIME_INDICATORS,
} from './intent-keywords';

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
  MONTHLY_SUMMARY = 'MONTHLY_SUMMARY', // Resumo mensal detalhado
  CATEGORY_BREAKDOWN = 'CATEGORY_BREAKDOWN', // Análise por categoria
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

    // 9. Verificar análise por categoria (mais específico, antes de resumo mensal)
    if (this.isCategoryBreakdownRequest(normalizedText)) {
      this.logger.log(`✅ Intent: CATEGORY_BREAKDOWN (confidence: 0.95)`);
      return {
        intent: MessageIntent.CATEGORY_BREAKDOWN,
        confidence: 0.95,
        shouldProcess: true,
        metadata: {
          monthReference: this.extractMonthReference(normalizedText),
        },
      };
    }

    // 9.1. Verificar resumo mensal (antes de saldo genérico)
    if (this.isMonthlySummaryRequest(normalizedText)) {
      this.logger.log(`✅ Intent: MONTHLY_SUMMARY (confidence: 0.95)`);
      return {
        intent: MessageIntent.MONTHLY_SUMMARY,
        confidence: 0.95,
        shouldProcess: true,
        metadata: {
          monthReference: this.extractMonthReference(normalizedText),
        },
      };
    }

    // 9.2. Verificar consultas de saldo/extrato (balanço geral)
    if (this.isBalanceCheck(normalizedText)) {
      this.logger.log(`✅ Intent: CHECK_BALANCE (confidence: 0.90)`);
      return {
        intent: MessageIntent.CHECK_BALANCE,
        confidence: 0.9,
        shouldProcess: true, // ✅ AGORA PROCESSA para buscar saldo real
      };
    }

    // 9.3. Verificar listagem de transações
    if (this.isListTransactions(normalizedText)) {
      this.logger.log(`✅ Intent: LIST_TRANSACTIONS (confidence: 0.90)`);
      return {
        intent: MessageIntent.LIST_TRANSACTIONS,
        confidence: 0.9,
        shouldProcess: true, // ✅ PROCESSA para listar transações
        metadata: {
          monthReference: this.extractMonthReference(normalizedText),
          limit: this.extractLimit(normalizedText),
        },
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
        '❓ *Não entendi sua mensagem*\n\n' +
        '💡 *Exemplos do que posso fazer:*\n\n' +
        '💸 "Gastei 50 no mercado"\n' +
        '💳 "Gastei 300 no cartão em 3x"\n' +
        '📊 "Resumo do mês" ou "Meu saldo"\n' +
        '📂 "Gastos por categoria"\n' +
        '📋 "Minhas transações"\n' +
        '📷 Envie foto da nota fiscal\n' +
        '🎤 Grave um áudio descrevendo\n\n' +
        '❓ Digite *"ajuda"* para ver todos os comandos.',
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
    for (const verb of TRANSACTION_VERBS) {
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
    let hasCategory = false;
    for (const keyword of CATEGORY_KEYWORDS) {
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
    for (const time of TIME_INDICATORS) {
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
    return GREETING_KEYWORDS.some((g) => text === g || text.startsWith(g + ' '));
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
    const isAskingHowAreYou = HOW_ARE_YOU_KEYWORDS.some((k) => text.includes(k));

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
      '   • "Gastei 300 no cartão em 3x"\n' +
      '📊 *Resumos:*\n' +
      '   • "Meu saldo" ou "Resumo do mês"\n' +
      '   • "Gastos por categoria"\n' +
      '📋 *Consultas:*\n' +
      '   • "Minhas transações"\n' +
      '   • "Minhas faturas" ou "Meus cartões"\n' +
      '📷 *Outras formas:*\n' +
      '   • Envie foto de nota fiscal\n' +
      '   • Grave um áudio descrevendo\n\n' +
      '✨ Use linguagem natural! Estou aqui para facilitar sua vida financeira.\n\n' +
      '❓ Digite *"ajuda"* para ver todos os comandos.';

    return greeting;
  }

  /**
   * Verifica se é uma solicitação de resumo mensal
   * Ex: "resumo do mês", "gastos do mês", "como estou no mês"
   */
  private isMonthlySummaryRequest(text: string): boolean {
    return MONTHLY_SUMMARY_KEYWORDS.some((k) => text.includes(k));
  }

  /**
   * Verifica se é uma solicitação de análise por categoria
   * Ex: "gastos por categoria", "quanto gastei em alimentação"
   */
  private isCategoryBreakdownRequest(text: string): boolean {
    return CATEGORY_BREAKDOWN_KEYWORDS.some((k) => text.includes(k));
  }

  /**
   * Extrai referência de mês da mensagem
   * Retorna formato YYYY-MM ou undefined se não encontrar
   */
  private extractMonthReference(text: string): string | undefined {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth(); // 0-indexed

    // "mês passado" / "mes passado"
    if (text.includes('mês passado') || text.includes('mes passado')) {
      const d = new Date(currentYear, currentMonth - 1, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    }

    // Nomes de meses em português
    const monthNames: Record<string, number> = {
      janeiro: 1, fevereiro: 2, março: 3, marco: 3,
      abril: 4, maio: 5, junho: 6,
      julho: 7, agosto: 8, setembro: 9,
      outubro: 10, novembro: 11, dezembro: 12,
    };

    for (const [name, month] of Object.entries(monthNames)) {
      if (text.includes(name)) {
        // Se o mês mencionado é futuro no ano atual, assume ano passado
        let year = currentYear;
        if (month > currentMonth + 1) {
          year = currentYear - 1;
        }
        return `${year}-${String(month).padStart(2, '0')}`;
      }
    }

    // Formato explícito MM/YYYY ou MM-YYYY
    const dateMatch = text.match(/(\d{1,2})[\/\-](\d{4})/);
    if (dateMatch) {
      const month = parseInt(dateMatch[1]);
      const year = parseInt(dateMatch[2]);
      if (month >= 1 && month <= 12 && year >= 2020 && year <= 2030) {
        return `${year}-${String(month).padStart(2, '0')}`;
      }
    }

    return undefined; // mês atual (handler decide o default)
  }

  /**
   * Extrai limite de resultados da mensagem
   * Ex: "últimas 5 transações" → 5
   */
  private extractLimit(text: string): number | undefined {
    const limitMatch = text.match(/(?:últimas?|ultimas?|top|primeiras?)\s+(\d+)/);
    if (limitMatch) {
      const num = parseInt(limitMatch[1]);
      if (num >= 1 && num <= 100) return num;
    }
    return undefined;
  }

  /**
   * Verifica se é um pedido de ajuda
   */
  private isHelpRequest(text: string): boolean {
    return HELP_KEYWORDS.some((k) => text.includes(k));
  }

  /**
   * Verifica se é consulta de saldo/extrato
   */
  private isBalanceCheck(text: string): boolean {
    return BALANCE_KEYWORDS.some((k) => text.includes(k));
  }

  /**
   * Verifica se é listagem de transações
   */
  private isListTransactions(text: string): boolean {
    return LIST_TRANSACTIONS_KEYWORDS.some((k) => text.includes(k));
  }

  /**
   * Verifica se é resposta de confirmação (sim/não)
   */
  private isConfirmationResponse(text: string): boolean {
    // Verifica se é uma resposta curta e direta (até 3 palavras)
    const words = text.trim().split(/\s+/);
    if (words.length > 3) {
      return false; // Mensagens longas não são confirmações simples
    }

    // Verificar pedidos de troca de categoria (resposta a confirmação pendente)
    // Palavras únicas correspondem exatamente; frases compostas usam startsWith
    const exactMatchChanges = ['trocar', 'mudar', 'errou'];
    const phraseChanges = ['outra categoria', 'mudar categoria', 'trocar categoria', 'categoria errada', 'categoria incorreta'];
    if (exactMatchChanges.some((k) => text === k) || phraseChanges.some((k) => text === k || text.startsWith(k))) {
      return true;
    }

    return (
      YES_RESPONSES.some((r) => text === r || text.startsWith(r + ' ')) ||
      NO_RESPONSES.some((r) => text === r || text.startsWith(r + ' '))
    );
  }

  /**
   * Verifica se é pedido para listar pendentes de CONFIRMAÇÃO
   * Palavras-chave ESPECÍFICAS para evitar ambiguidade
   */
  private isListPendingRequest(text: string): boolean {
    return LIST_PENDING_CONFIRMATION_KEYWORDS.some((k) => text.includes(k));
  }

  /**
   * Verifica se é pedido para listar pendentes de PAGAMENTO
   * Palavras-chave GENÉRICAS (só usa se não for confirmação)
   *
   * IMPORTANTE: Este método só é chamado se isListPendingRequest() retornar false
   */
  private isListPendingPaymentsRequest(text: string): boolean {
    // Apenas palavra "pendentes" ou "pendente" sozinha também conta como PAGAMENTO
    const hasPendingWord = PENDING_STANDALONE_WORDS.some((w) => text === w);

    return LIST_PENDING_PAYMENT_KEYWORDS.some((k) => text.includes(k)) || hasPendingWord;
  }

  /**
   * Retorna mensagem de ajuda
   */
  private getHelpMessage(): string {
    return (
      '📖 *Guia de Uso - GastoCerto*\n\n' +
      '💸 *Registrar transações:*\n' +
      '   • "Gastei 50 no mercado"\n' +
      '   • "Recebi 1000 de salário"\n' +
      '   • "Gastei 300 no cartão em 3x"\n' +
      '   • "Paguei 80 no nubank"\n' +
      '📊 *Resumos e Análises:*\n' +
      '   • "Meu saldo" - Balanço geral\n' +
      '   • "Resumo do mês" - Resumo mensal detalhado\n' +
      '   • "Resumo de janeiro" - Resumo de outro mês\n' +
      '   • "Gastos por categoria" - Análise por categoria\n' +
      '📋 *Transações:*\n' +
      '   • "Minhas transações" - Listar do mês\n' +
      '   • "Transações de fevereiro" - Outro mês\n' +
      '   • "Últimas 5 transações" - Limitar\n' +
      '💳 *Cartões de Crédito:*\n' +
      '   • "Meus cartões" - Listar cartões\n' +
      '   • "Usar cartão nubank" - Definir padrão\n' +
      '   • "Meu cartão" - Ver cartão padrão\n' +
      '   • "Minhas faturas" - Ver faturas\n' +
      '   • "Fatura nubank" - Fatura de um cartão\n' +
      '   • "Ver fatura 1" / "Pagar fatura 1"\n' +
      '📋 *Contas Pendentes:*\n' +
      '   • "Pendentes" - Contas a pagar/receber\n' +
      '   • "Pendentes de confirmação"\n' +
      '🏦 *Perfil:*\n' +
      '   • "Meus perfis" - Ver todas as contas\n' +
      '   • "Perfil" - Ver conta ativa\n' +
      '   • "Trocar perfil" - Mudar conta\n' +
      '📷 *Nota Fiscal:* Envie uma foto\n' +
      '🎤 *Áudio:* Grave descrevendo a transação\n\n'
    );
  }

  /**
   * Verifica se é uma solicitação de troca de conta
   */
  private isSwitchAccountRequest(text: string): boolean {
    // Verificar padrões diretos
    if (SWITCH_ACCOUNT_KEYWORDS.some((k) => text.includes(k))) {
      return true;
    }

    // Verificar padrão "usar [nome da conta]"
    // ⚠️ Excluir "usar cartão/cartao" pois deve cair em SET_DEFAULT_CREDIT_CARD
    if (
      text.startsWith('usar ') &&
      text.split(' ').length >= 2 &&
      !text.includes('cartao') &&
      !text.includes('cart\u00e3o')
    ) {
      return true;
    }

    return false;
  }

  /**
   * Verifica se é uma solicitação de listagem de contas
   */
  private isListAccountsRequest(text: string): boolean {
    return LIST_ACCOUNTS_KEYWORDS.some((k) => text.includes(k));
  }

  /**
   * Verifica se é uma solicitação para mostrar conta ativa
   */
  private isShowActiveAccountRequest(text: string): boolean {
    return SHOW_ACTIVE_ACCOUNT_KEYWORDS.some((k) => text.includes(k));
  }

  /**
   * Verifica se é uma solicitação de pagamento de fatura/conta
   */
  private isPayBillRequest(text: string): boolean {
    return PAY_BILL_KEYWORDS.some((k) => text.includes(k));
  }

  /**
   * Verifica se é uma solicitação para listar cartões de crédito
   */
  private isListCreditCardsRequest(text: string): boolean {
    return LIST_CREDIT_CARDS_KEYWORDS.some((k) => text.includes(k));
  }

  /**
   * Verifica se é uma solicitação para definir cartão padrão
   */
  private isSetDefaultCreditCardRequest(text: string): boolean {
    return SET_DEFAULT_CARD_KEYWORDS.some((k) => text.includes(k));
  }

  /**
   * Verifica se é uma solicitação para ver cartão padrão
   */
  private isShowDefaultCreditCardRequest(text: string): boolean {
    // Evitar match com "qual cartao pagar" ou "qual cartao usar"
    if (SHOW_DEFAULT_CARD_EXCLUSIONS.some((e) => text.includes(e))) {
      return false;
    }
    return SHOW_DEFAULT_CARD_KEYWORDS.some((k) => text.includes(k));
  }

  /**
   * Verifica se é uma solicitação para ver fatura por nome do cartão
   * Ex: "ver fatura nubank", "fatura itau", "fatura do inter"
   */
  private isShowInvoiceByCardNameRequest(text: string): boolean {
    const hasInvoiceKeyword = INVOICE_TRIGGER_KEYWORDS.some((k) => text.includes(k));

    // Verificar se não é comando de lista genérica
    const isGenericList =
      INVOICE_GENERIC_LIST_KEYWORDS.some((k) => text.includes(k)) ||
      /ver fatura \d/.test(text) || // "ver fatura 1"
      /pagar fatura \d/.test(text); // "pagar fatura 1"

    // Se tem "fatura" mas não é lista genérica, pode ser busca por nome
    return hasInvoiceKeyword && !isGenericList && text.length > 6;
  }

  /**
   * Verifica se é uma solicitação para listar faturas de cartão
   */
  private isListInvoicesRequest(text: string): boolean {
    return LIST_INVOICES_KEYWORDS.some((k) => text.includes(k));
  }

  /**
   * Verifica se é uma solicitação para ver detalhes de uma fatura
   */
  private isShowInvoiceDetailsRequest(text: string): boolean {
    return INVOICE_DETAILS_KEYWORDS.some((k) => text.includes(k));
  }

  /**
   * Verifica se é uma solicitação para pagar fatura de cartão (invoice)
   */
  private isPayInvoiceRequest(text: string): boolean {
    return PAY_INVOICE_KEYWORDS.some((k) => text.includes(k));
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
