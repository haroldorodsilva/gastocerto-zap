import { Injectable, Logger } from '@nestjs/common';
import { SecurityService } from '../security/security.service';
import { UserCacheService } from '@features/users/user-cache.service';
import { IntentAnalyzerService } from './intent/intent-analyzer.service';
import { TransactionsService } from '@features/transactions/transactions.service';
import { PrismaService } from '@core/database/prisma.service';

interface AssistantResponse {
  success: boolean;
  message: string;
  type: 'transaction' | 'query' | 'help' | 'error' | 'security';
  data?: any;
  requiresConfirmation?: boolean;
}

/**
 * AssistantService - Orquestrador Conversacional Humanizado
 *
 * Fluxo completo:
 * 1. Segurança (SecurityService) ← PRIMEIRO
 * 2. Verificar onboarding
 * 3. Análise de intenção (IntentAnalyzer)
 * 4. Roteamento inteligente
 * 5. Resposta humanizada
 *
 * Performance:
 * - Cache agressivo
 * - Respostas rápidas sem IA quando possível
 * - Fallback local antes de API
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  // Respostas rápidas (sem IA) para economizar
  private readonly QUICK_RESPONSES = {
    greeting: [
      'Olá! 👋 Como posso ajudar com suas finanças hoje?',
      'Oi! Estou aqui para te ajudar. O que precisa?',
      'Olá! Pronto para gerenciar suas finanças? 💰',
    ],
    thanks: [
      'Por nada! Estou aqui sempre que precisar! 😊',
      'Disponha! Qualquer coisa é só chamar.',
      'Fico feliz em ajudar! 🙌',
    ],
    help: `🤖 *Assistente Financeiro GastoCerto*

Eu posso te ajudar com:

💰 *Registrar Gastos*
• "Gastei R$ 50 no mercado"
• "Paguei R$ 150 de luz"
• Envie foto da nota fiscal
• Envie áudio descrevendo a compra

📊 *Consultas*
• "Quanto gastei este mês?"
• "Quanto gastei em alimentação?"
• "Meu saldo"
• "Minhas transações"

💳 *Pagamentos*
• "Paguei a conta de luz"
• "Quitei o cartão"

✅ *Confirmações*
• "Sim" ou "Não" para confirmar transações

Como posso ajudar? 😊`,
  };

  constructor(
    private security: SecurityService,
    private userCache: UserCacheService,
    private intentAnalyzer: IntentAnalyzerService,
    private transactions: TransactionsService,
    private prisma: PrismaService,
  ) {
    this.logger.log('🤖 AssistantService inicializado');
  }

  /**
   * ✨ MÉTODO PRINCIPAL
   * Processa mensagem do usuário de forma humanizada
   */
  async processMessage(
    phoneNumber: string,
    message: string,
    platform: 'whatsapp' | 'telegram' = 'whatsapp',
  ): Promise<AssistantResponse> {
    const startTime = Date.now();

    try {
      // 1️⃣ CAMADA DE SEGURANÇA (PRIMEIRO!)
      this.logger.debug(`🔐 [${phoneNumber}] Validando segurança...`);
      const securityCheck = await this.security.validateUserMessage(phoneNumber, message, platform);

      if (!securityCheck.safe) {
        this.logger.warn(`🚨 [${phoneNumber}] Segurança bloqueou: ${securityCheck.reason}`);
        return {
          success: false,
          message: securityCheck.reason || 'Mensagem inválida',
          type: 'security',
        };
      }

      // 2️⃣ VERIFICAR ONBOARDING
      const user = await this.userCache.getUser(phoneNumber);
      if (!user || !user.gastoCertoId) {
        // Não processar, deixar OnboardingService lidar
        return {
          success: false,
          message: 'Complete o cadastro primeiro',
          type: 'error',
        };
      }

      // 3️⃣ RESPOSTAS RÁPIDAS (sem IA - economia!)
      const quickResponse = this.tryQuickResponse(message);
      if (quickResponse) {
        this.logger.debug(`⚡ [${phoneNumber}] Resposta rápida (${Date.now() - startTime}ms)`);
        return {
          success: true,
          message: quickResponse,
          type: 'help',
        };
      }

      // 4️⃣ ANÁLISE DE INTENÇÃO (com cache)
      this.logger.debug(`🧠 [${phoneNumber}] Analisando intenção...`);
      const intent = await this.intentAnalyzer.analyzeIntent(message);

      this.logger.log(
        `🎯 [${phoneNumber}] Intent: ${intent.intent} (${(intent.confidence * 100).toFixed(1)}%)`,
      );

      // 5️⃣ ROTEAMENTO INTELIGENTE
      const response = await this.routeIntent(phoneNumber, message, intent, user);

      // 6️⃣ HUMANIZAR RESPOSTA
      const humanized = this.humanizeResponse(response, intent);

      const elapsed = Date.now() - startTime;
      this.logger.log(`✅ [${phoneNumber}] Processado em ${elapsed}ms`);

      return humanized;
    } catch (error) {
      this.logger.error(`❌ [${phoneNumber}] Erro:`, error);
      return {
        success: false,
        message: this.getErrorMessage(error),
        type: 'error',
      };
    }
  }

  /**
   * Tenta resposta rápida (sem IA)
   * Economia: 100% (não chama API)
   */
  private tryQuickResponse(message: string): string | null {
    const lower = message.toLowerCase().trim();

    // Saudações
    if (/^(oi|olá|ola|hey|e ai|eae|bom dia|boa tarde|boa noite)[\s!?]*$/i.test(lower)) {
      return this.randomChoice(this.QUICK_RESPONSES.greeting);
    }

    // Agradecimentos
    if (/^(obrigad[oa]|valeu|vlw|thanks|thx)[\s!?]*$/i.test(lower)) {
      return this.randomChoice(this.QUICK_RESPONSES.thanks);
    }

    // Ajuda
    if (/^(ajuda|help|como funciona|comandos|o que.*fazer)[\s?]*$/i.test(lower)) {
      return this.QUICK_RESPONSES.help;
    }

    return null;
  }

  /**
   * Roteia intenção para serviço apropriado
   */
  private async routeIntent(
    phoneNumber: string,
    message: string,
    intent: any,
    user: any,
  ): Promise<any> {
    switch (intent.intent) {
      // 💰 Registrar transação
      case 'REGISTER_TRANSACTION':
      case 'REGISTER_EXPENSE':
      case 'REGISTER_INCOME':
        return await this.transactions.processTextMessage(phoneNumber, message, 'msg-id');

      // ✅ Confirmar transação
      case 'CONFIRMATION_RESPONSE':
        return await this.transactions.processConfirmation(phoneNumber, message);

      // 📋 Listar transações
      case 'LIST_TRANSACTIONS':
      case 'LIST_EXPENSES':
      case 'LIST_INCOME':
        return await this.transactions.listTransactions(phoneNumber, {
          type:
            intent.intent === 'LIST_EXPENSES'
              ? 'EXPENSES'
              : intent.intent === 'LIST_INCOME'
                ? 'INCOME'
                : undefined,
        });

      // 💰 Consultar saldo
      case 'QUERY_BALANCE':
      case 'QUERY_SPENDING':
        return await this.transactions.getBalance(phoneNumber);

      // 💳 Pagamento
      case 'PAYMENT':
        return await this.transactions.processPayment(phoneNumber, message);

      // 📊 Resumo
      case 'SUMMARY':
        return await this.transactions.getSummary(phoneNumber);

      // 🆘 Ajuda
      case 'HELP':
        return {
          success: true,
          message: this.QUICK_RESPONSES.help,
        };

      // 👋 Saudação
      case 'GREETING':
        return {
          success: true,
          message: this.randomChoice(this.QUICK_RESPONSES.greeting),
        };

      // ❓ Não entendeu
      default:
        return {
          success: false,
          message: intent.suggestedResponse || this.getDidNotUnderstandMessage(),
        };
    }
  }

  /**
   * Humaniza resposta baseada no contexto
   */
  private humanizeResponse(response: any, intent: any): AssistantResponse {
    // Se já é um AssistantResponse, retornar
    if (response.type) {
      return response;
    }

    // Transformar resposta do TransactionsService
    return {
      success: response.success,
      message: response.message,
      type: this.inferType(intent.intent),
      data: response.data,
      requiresConfirmation: response.requiresConfirmation,
    };
  }

  /**
   * Infere tipo de resposta baseado em intent
   */
  private inferType(intent: string): AssistantResponse['type'] {
    if (intent.startsWith('REGISTER')) return 'transaction';
    if (intent.startsWith('LIST') || intent.startsWith('QUERY')) return 'query';
    if (intent === 'HELP') return 'help';
    return 'transaction';
  }

  /**
   * Mensagem quando não entende
   */
  private getDidNotUnderstandMessage(): string {
    return `🤔 Não entendi bem. Você pode:

• Registrar um gasto: _"Gastei R$ 50 no mercado"_
• Ver suas transações: _"Minhas transações"_
• Consultar saldo: _"Meu saldo"_
• Pedir ajuda: _"Ajuda"_

O que gostaria de fazer?`;
  }

  /**
   * Mensagem de erro humanizada
   */
  private getErrorMessage(error: any): string {
    if (error.message?.includes('API')) {
      return '⚠️ Estou com dificuldades técnicas no momento. Por favor, tente novamente em alguns instantes.';
    }

    if (error.message?.includes('timeout')) {
      return '⏰ A operação está demorando mais que o esperado. Tente novamente.';
    }

    return '❌ Ops! Algo deu errado. Tente novamente ou digite "ajuda".';
  }

  /**
   * Escolhe resposta aleatória (mais humano)
   */
  private randomChoice(arr: string[]): string {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  /**
   * Estatísticas do assistente (dashboard)
   */
  async getStats(startDate?: Date, endDate?: Date) {
    const start = startDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const end = endDate || new Date();

    return {
      period: { start, end },
      totalMessages: 0,
      quickResponses: 0,
      aiCalls: 0,
      avgResponseTime: 0,
      topIntents: [],
    };
  }

  /**
   * Top intenções detectadas
   */
  async getTopIntents(startDate?: Date, endDate?: Date, limit = 20) {
    return [];
  }

  /**
   * Taxa de cache hit
   */
  async getCacheHitRate(days = 7) {
    return {
      days,
      cacheHits: 0,
      cacheMisses: 0,
      hitRate: 0,
    };
  }

  /**
   * Busca configurações do assistente
   */
  async getAssistantSettings(userId: string) {
    const settings = await this.prisma.aISettings.findUnique({
      where: { id: userId },
    });

    return {
      assistantEnabled: settings?.assistantEnabled ?? true,
      assistantPersonality: settings?.assistantPersonality ?? 'friendly',
      assistantMaxHistoryMsgs: settings?.assistantMaxHistoryMsgs ?? 5,
    };
  }

  /**
   * Atualiza configurações do assistente
   */
  async updateAssistantSettings(
    userId: string,
    data: {
      assistantEnabled?: boolean;
      assistantPersonality?: 'friendly' | 'professional' | 'casual';
      assistantMaxHistoryMsgs?: number;
    },
  ) {
    return this.prisma.aISettings.update({
      where: { id: userId },
      data: {
        ...data,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Detecta intenção (wrapper para IntentAnalyzer)
   */
  async detectIntent(userId: string, message: string) {
    return this.intentAnalyzer.detectIntent(message);
  }

  /**
   * Retorna padrões de quick responses
   */
  getQuickResponsePatterns() {
    return {
      greeting: ['oi', 'olá', 'hey', 'bom dia', 'boa tarde', 'boa noite'],
      thanks: ['obrigado', 'obrigada', 'valeu', 'thanks'],
      help: ['ajuda', 'help', 'socorro', 'como', 'menu'],
    };
  }

  /**
   * Métricas de performance
   */
  async getPerformanceMetrics(days = 7) {
    return {
      days,
      avgResponseTime: 0,
      quickResponseRate: 0,
      cacheHitRate: 0,
      errorRate: 0,
    };
  }

  /**
   * Histórico de conversas do usuário
   */
  async getUserConversations(userId: string, skip = 0, take = 50) {
    return [];
  }

  /**
   * Conta conversas do usuário
   */
  async getUserConversationsCount(userId: string) {
    return 0;
  }

  /**
   * Mensagens não compreendidas (para treinar)
   */
  async getNotUnderstoodMessages(
    startDate?: Date,
    endDate?: Date,
    limit = 50,
  ) {
    const messages = await this.prisma.unrecognizedMessage.findMany({
      where: {
        createdAt: {
          ...(startDate && { gte: startDate }),
          ...(endDate && { lte: endDate }),
        },
      },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });

    return messages;
  }

  /**
   * Adiciona exemplo de treinamento
   */
  async addTrainingExample(
    message: string,
    intent: string,
    entities?: Record<string, any>,
  ) {
    // Implementar storage de exemplos de treinamento
    this.logger.log(`Training example added: ${intent} -> ${message}`);
  }
}
