import { Injectable, Logger } from '@nestjs/common';
import { TransactionsService } from '@features/transactions/transactions.service';
import { UserCacheService } from '@features/users/user-cache.service';
import { MessageLearningService } from '@features/transactions/message-learning.service';
import { WebChatResponse } from './webchat.controller';

/**
 * WebChatService
 *
 * Serviço para processar mensagens do chat web do frontend.
 * Reutiliza toda a lógica de processamento de transações do WhatsApp/Telegram.
 *
 * Fluxo:
 * 1. Recebe mensagem do frontend (usuário já autenticado)
 * 2. Busca dados do usuário no cache/banco
 * 3. Processa usando TransactionsService (mesma lógica WhatsApp)
 * 4. Formata resposta estruturada para o frontend
 */
@Injectable()
export class WebChatService {
  private readonly logger = new Logger(WebChatService.name);

  constructor(
    private readonly transactionsService: TransactionsService,
    private readonly userCacheService: UserCacheService,
    private readonly messageLearningService: MessageLearningService,
  ) {}

  /**
   * Processa mensagem do chat web
   */
  async processMessage(userId: string, messageText: string): Promise<WebChatResponse> {
    this.logger.log(`📝 [WebChat] Processando mensagem do usuário ${userId}`);

    try {
      // 1. Buscar usuário pelo gastoCertoId
      const user = await this.userCacheService.getUserByGastoCertoId(userId);

      if (!user) {
        this.logger.warn(`⚠️ [WebChat] Usuário ${userId} não encontrado no cache`);
        return {
          success: false,
          messageType: 'error',
          message:
            '❌ Usuário não encontrado. Por favor, complete seu cadastro via WhatsApp primeiro.',
          formatting: {
            emoji: '❌',
            color: 'error',
          },
        };
      }

      const phoneNumber = user.phoneNumber;
      this.logger.log(`✅ [WebChat] Usuário encontrado: ${user.name} (${phoneNumber})`);

      // 2. Verificar se há contexto de aprendizado pendente
      const learningStatus = await this.messageLearningService.hasPendingLearning(phoneNumber);
      const hasLearningContext = learningStatus.hasPending;

      if (hasLearningContext) {
        this.logger.log(`🎓 [WebChat] Usuário tem contexto de aprendizado pendente`);

        const learningResult = await this.messageLearningService.processLearningMessage(
          phoneNumber,
          messageText,
        );

        if (learningResult.success) {
          // Se deve processar transação original após aprendizado
          if (learningResult.shouldProcessOriginalTransaction && learningResult.originalText) {
            this.logger.log(`🔄 [WebChat] Processando transação original após aprendizado`);

            const transactionResult = await this.messageLearningService.processOriginalTransaction(
              phoneNumber,
              learningResult.originalText,
              `webchat-${Date.now()}`,
              user,
              'whatsapp', // Usar whatsapp como fallback para compatibilidade
            );

            return this.formatTransactionResponse(transactionResult, learningResult.message);
          }

          // Aprendizado concluído, retornar opções se houver
          return this.formatLearningResponse(learningResult);
        }
      }

      // 3. Processar como mensagem de transação normal
      this.logger.log(`💰 [WebChat] Processando como transação normal`);

      const result = await this.transactionsService.processTextMessage(
        phoneNumber,
        messageText,
        `webchat-${Date.now()}`,
        'whatsapp', // Usar whatsapp como platform para compatibilidade
      );

      return this.formatTransactionResponse(result);
    } catch (error) {
      this.logger.error(`❌ [WebChat] Erro ao processar mensagem:`, error);
      throw error;
    }
  }

  /**
   * Formata resposta de transação para o frontend
   */
  private formatTransactionResponse(result: any, additionalMessage?: string): WebChatResponse {
    // Detectar tipo de resposta baseado no resultado
    let messageType: WebChatResponse['messageType'] = 'info';
    let emoji = '💬';
    let color: 'success' | 'warning' | 'info' | 'error' = 'info';

    if (result.requiresConfirmation) {
      messageType = 'confirmation';
      emoji = '❓';
      color = 'warning';
    } else if (result.success) {
      messageType = 'transaction';
      emoji = '✅';
      color = 'success';
    } else if (!result.success && result.message.includes('❌')) {
      messageType = 'error';
      emoji = '❌';
      color = 'error';
    }

    // Extrair dados da transação se disponível
    const data: WebChatResponse['data'] = {};

    if (result.requiresConfirmation) {
      data.requiresConfirmation = true;
      data.confirmationId = result.confirmationId;
    }

    // Tentar extrair valores da mensagem (formato comum: "R$ 50,00")
    const amountMatch = result.message.match(/R\$\s*([\d.,]+)/);
    if (amountMatch) {
      data.amount = parseFloat(amountMatch[1].replace('.', '').replace(',', '.'));
    }

    // Extrair categoria se mencionada
    const categoryMatch = result.message.match(/categoria[:\s]+([^\n]+)/i);
    if (categoryMatch) {
      data.category = categoryMatch[1].trim();
    }

    // Combinar mensagens se houver mensagem adicional (do aprendizado)
    const finalMessage = additionalMessage
      ? `${additionalMessage}\n\n${result.message}`
      : result.message;

    return {
      success: result.success,
      messageType,
      message: finalMessage,
      data: Object.keys(data).length > 0 ? data : undefined,
      formatting: {
        emoji,
        color,
        highlight: this.extractHighlights(finalMessage),
      },
    };
  }

  /**
   * Formata resposta de aprendizado RAG para o frontend
   */
  private formatLearningResponse(result: any): WebChatResponse {
    const data: WebChatResponse['data'] = {};

    // Se houver opções de aprendizado, incluir no data
    if (result.learningOptions) {
      data.learningOptions = result.learningOptions;
    }

    return {
      success: result.success,
      messageType: 'learning',
      message: result.message,
      data: Object.keys(data).length > 0 ? data : undefined,
      formatting: {
        emoji: '🎓',
        color: 'info',
        highlight: this.extractHighlights(result.message),
      },
    };
  }

  /**
   * Extrai partes importantes do texto para destacar no frontend
   * Ex: valores monetários, categorias, datas
   */
  private extractHighlights(message: string): string[] {
    const highlights: string[] = [];

    // Extrair valores monetários (R$ 50,00)
    const amounts = message.match(/R\$\s*[\d.,]+/g);
    if (amounts) {
      highlights.push(...amounts);
    }

    // Extrair categorias comuns
    const categories = [
      'supermercado',
      'transporte',
      'alimentação',
      'saúde',
      'educação',
      'lazer',
      'moradia',
      'outros',
    ];

    categories.forEach((cat) => {
      if (message.toLowerCase().includes(cat)) {
        // Encontrar a palavra completa no texto original (mantém capitalização)
        const regex = new RegExp(`\\b${cat}\\b`, 'i');
        const match = message.match(regex);
        if (match) {
          highlights.push(match[0]);
        }
      }
    });

    // Extrair datas (dd/mm/yyyy ou variações)
    const dates = message.match(/\d{1,2}\/\d{1,2}(?:\/\d{2,4})?/g);
    if (dates) {
      highlights.push(...dates);
    }

    return [...new Set(highlights)]; // Remove duplicatas
  }
}
