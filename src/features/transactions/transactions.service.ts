import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UserCacheService } from '@features/users/user-cache.service';
import { IntentAnalyzerService } from '@features/intent/intent-analyzer.service';
import { AccountManagementService } from '@features/accounts/account-management.service';
import { SecurityService } from '@features/security/security.service';
import { TransactionRegistrationService } from './contexts/registration/registration.service';
import { TransactionListingService } from './contexts/listing/listing.service';
import { TransactionPaymentService } from './contexts/payment/payment.service';
import { TransactionSummaryService } from './contexts/summary/summary.service';
import { TransactionConfirmationService } from './transaction-confirmation.service';

export interface ProcessMessageResult {
  success: boolean;
  message: string;
  requiresConfirmation: boolean;
  confirmationId?: string;
  autoRegistered?: boolean;
  platform?: 'whatsapp' | 'telegram';
}

/**
 * TransactionsService - ORCHESTRATOR
 *
 * Orquestra o processamento de mensagens relacionadas a transações,
 * delegando para serviços especializados por contexto:
 *
 * - AccountManagementService: Gerenciar contas (listar, trocar, mostrar ativa)
 * - TransactionRegistrationService: Registrar novas transações (texto/imagem/áudio)
 * - TransactionListingService: Listar e filtrar transações
 * - TransactionPaymentService: Pagar contas e faturas
 * - TransactionSummaryService: Gerar resumos e análises
 * - TransactionConfirmationService: Confirmar/rejeitar transações pendentes
 */
@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    private readonly userCache: UserCacheService,
    private readonly intentAnalyzer: IntentAnalyzerService,
    private readonly accountManagement: AccountManagementService,
    private readonly securityService: SecurityService,
    private readonly eventEmitter: EventEmitter2,
    private readonly registrationService: TransactionRegistrationService,
    private readonly listingService: TransactionListingService,
    private readonly paymentService: TransactionPaymentService,
    private readonly summaryService: TransactionSummaryService,
    private readonly confirmationService: TransactionConfirmationService,
  ) {
    this.logger.log('🎯 TransactionsService (Orchestrator) inicializado');
  }

  /**
   * ✨ Helper para emitir eventos de resposta para a plataforma correta
   */
  private emitReply(
    phoneNumber: string,
    message: string,
    platform: 'whatsapp' | 'telegram',
    context: 'INTENT_RESPONSE' | 'CONFIRMATION_REQUEST' | 'TRANSACTION_RESULT' | 'ERROR',
    metadata?: any,
  ): void {
    const eventName = platform === 'telegram' ? 'telegram.reply' : 'whatsapp.reply';

    this.logger.debug(`📤 Emitindo evento ${eventName} para ${phoneNumber}`);

    this.eventEmitter.emit(eventName, {
      platformId: phoneNumber,
      message,
      context,
      metadata,
      platform,
    });
  }

  /**
   * Processa mensagem de texto e extrai transação
   * DELEGA para TransactionRegistrationService
   */
  async processTextMessage(
    phoneNumber: string,
    text: string,
    messageId: string,
    platform: 'whatsapp' | 'telegram' = 'whatsapp',
  ): Promise<ProcessMessageResult> {
    try {
      this.logger.log(`📝 [Orchestrator] Processando texto de ${phoneNumber} | Platform: ${platform}`);

      // 0. Validação de segurança (prompt injection, mensagens maliciosas)
      const securityValidation = await this.securityService.validateUserMessage(
        phoneNumber,
        text,
        platform,
      );

      if (!securityValidation.safe) {
        this.logger.warn(
          `⚠️ Mensagem bloqueada por segurança: ${securityValidation.reason} | ` +
            `Severidade: ${securityValidation.severity}`,
        );
        return {
          success: false,
          message:
            '🛡️ Sua mensagem contém conteúdo não permitido.\n\n' +
            'Por favor, reformule e envie novamente.',
          requiresConfirmation: false,
        };
      }

      // 1. Buscar usuário
      const user = await this.userCache.getUser(phoneNumber);
      if (!user) {
        return {
          success: false,
          message: '❌ Usuário não encontrado. Complete o cadastro primeiro.',
          requiresConfirmation: false,
        };
      }

      // 2. Analisar intenção com NLP
      const intentResult = await this.intentAnalyzer.analyzeIntent(text, phoneNumber, user.id);

      this.logger.log(
        `🎯 Intent: ${intentResult.intent} | Confiança: ${(intentResult.confidence * 100).toFixed(1)}%`,
      );

      // 2a. VERIFICAR SE HÁ CONFIRMAÇÃO PENDENTE (bloqueio de contexto)
      const hasPending = await this.confirmationService.getPendingConfirmation(phoneNumber);

      if (hasPending) {
        this.logger.log(`⏸️  Usuário tem confirmação pendente - bloqueando novas transações`);

        // Permitir apenas: confirmação (sim/não) ou consultas
        const allowedIntents = [
          'CONFIRMATION_RESPONSE',
          'LIST_PENDING',
          'CHECK_BALANCE',
          'LIST_TRANSACTIONS',
          'HELP',
          'GREETING',
        ];

        if (!allowedIntents.includes(intentResult.intent)) {
          const blockMessage =
            '⏸️  *Você tem uma transação aguardando confirmação!*\n\n' +
            'Por favor, primeiro responda:\n' +
            '✅ Digite *"sim"* para confirmar\n' +
            '❌ Digite *"não"* para cancelar\n\n' +
            '💡 Ou digite *"pendentes"* para ver detalhes';

          this.emitReply(phoneNumber, blockMessage, platform, 'CONFIRMATION_REQUEST', {
            hasPending: true,
            confirmationId: hasPending.id,
          });

          return {
            success: false,
            message: blockMessage,
            requiresConfirmation: true,
            confirmationId: hasPending.id,
          };
        }
      }

      // Se não deve processar, retornar resposta sugerida
      if (!intentResult.shouldProcess) {
        const responseMessage =
          intentResult.suggestedResponse ||
          'Mensagem recebida. Para registrar transações, envie: "Gastei R$50 no mercado"';

        this.emitReply(phoneNumber, responseMessage, platform, 'INTENT_RESPONSE', {
          intent: intentResult.intent,
          confidence: intentResult.confidence,
        });

        return {
          success: true,
          message: responseMessage,
          requiresConfirmation: false,
        };
      }

      // 3. ROTEAMENTO por intent
      // 3a. Confirmação de transação (sim/não)
      if (intentResult.intent === 'CONFIRMATION_RESPONSE') {
        this.logger.log(`✅ Delegando para processConfirmation`);
        const confirmResult = await this.processConfirmation(phoneNumber, text);

        this.emitReply(phoneNumber, confirmResult.message, platform, 'TRANSACTION_RESULT', {
          success: confirmResult.success,
        });

        return {
          success: confirmResult.success,
          message: confirmResult.message,
          requiresConfirmation: false,
        };
      }

      // 3a-1. CONTEXTO: Seleção numérica de conta (1, 2, 3)
      // Se mensagem é só número E usuário tem múltiplas contas, tratar como seleção
      const trimmedText = text.trim();
      const isNumericSelection = /^[0-9]$/.test(trimmedText);

      if (isNumericSelection) {
        const accounts = await this.userCache.listAccounts(phoneNumber);

        if (accounts.length > 1) {
          this.logger.log(`🔢 Detectada seleção numérica de conta: ${trimmedText}`);
          const result = await this.accountManagement.selectAccountByNumber(
            phoneNumber,
            trimmedText,
          );

          this.emitReply(phoneNumber, result.message, platform, 'INTENT_RESPONSE', {
            success: result.success,
          });

          return {
            success: result.success,
            message: result.message,
            requiresConfirmation: false,
          };
        }
      }

      // 3b. Listar contas do usuário
      if (intentResult.intent === 'LIST_ACCOUNTS') {
        this.logger.log(`✅ Delegando para AccountManagementService.listUserAccounts`);
        const result = await this.accountManagement.listUserAccounts(phoneNumber);

        this.emitReply(phoneNumber, result.message, platform, 'INTENT_RESPONSE', {
          success: result.success,
        });

        return {
          success: result.success,
          message: result.message,
          requiresConfirmation: false,
        };
      }

      // 3c. Mostrar conta ativa
      if (intentResult.intent === 'SHOW_ACTIVE_ACCOUNT') {
        this.logger.log(`✅ Delegando para AccountManagementService.showActiveAccount`);
        const result = await this.accountManagement.showActiveAccount(phoneNumber);

        this.emitReply(phoneNumber, result.message, platform, 'INTENT_RESPONSE', {
          success: result.success,
        });

        return {
          success: result.success,
          message: result.message,
          requiresConfirmation: false,
        };
      }

      // 3d. Trocar conta ativa
      if (intentResult.intent === 'SWITCH_ACCOUNT') {
        this.logger.log(`✅ Delegando para AccountManagementService.switchAccount`);
        const result = await this.accountManagement.switchAccount(phoneNumber, text);

        this.emitReply(phoneNumber, result.message, platform, 'INTENT_RESPONSE', {
          success: result.success,
        });

        return {
          success: result.success,
          message: result.message,
          requiresConfirmation: result.requiresConfirmation || false,
        };
      }

      // 3e. Listar transações pendentes
      if (intentResult.intent === 'LIST_PENDING') {
        this.logger.log(`✅ Delegando para listPendingConfirmations`);
        const listResult = await this.listPendingConfirmations(phoneNumber);

        this.emitReply(phoneNumber, listResult.message, platform, 'TRANSACTION_RESULT', {
          success: listResult.success,
        });

        return {
          success: listResult.success,
          message: listResult.message,
          requiresConfirmation: false,
        };
      }

      // 3f. Consultar saldo
      if (intentResult.intent === 'CHECK_BALANCE') {
        this.logger.log(`✅ Delegando para TransactionSummaryService.generateBalanceSummary`);
        const result = await this.summaryService.generateSummary(user, { summaryType: 'balance' });

        this.emitReply(phoneNumber, result.message, platform, 'INTENT_RESPONSE', {
          success: result.success,
        });

        return {
          success: result.success,
          message: result.message,
          requiresConfirmation: false,
        };
      }

      // 3g. Listar transações
      if (intentResult.intent === 'LIST_TRANSACTIONS') {
        this.logger.log(`✅ Delegando para TransactionListingService.listTransactions`);
        const result = await this.listingService.listTransactions(user, {
          period: 'month', // Padrão: mês atual
          limit: 10, // Mostrar últimas 10
        });

        this.emitReply(phoneNumber, result.message, platform, 'INTENT_RESPONSE', {
          success: result.success,
        });

        return {
          success: result.success,
          message: result.message,
          requiresConfirmation: false,
        };
      }

      // 3h. Registro de transação (padrão)
      this.logger.log(`✅ Delegando para TransactionRegistrationService`);
      const result = await this.registrationService.processTextTransaction(
        phoneNumber,
        text,
        messageId,
        user,
        platform, // Passar platform da mensagem
      );

      // 4. Emitir resposta se houver mensagem
      if (result.message) {
        const context = result.requiresConfirmation ? 'CONFIRMATION_REQUEST' : 'TRANSACTION_RESULT';
        this.emitReply(phoneNumber, result.message, platform, context, {
          success: result.success,
          confirmationId: result.confirmationId,
        });
      }

      return { ...result, platform };
    } catch (error) {
      this.logger.error(`❌ Erro ao processar texto:`, error);
      return {
        success: false,
        message: '❌ Erro ao processar mensagem.',
        requiresConfirmation: false,
      };
    }
  }

  /**
   * Processa mensagem de imagem (nota fiscal/recibo)
   * DELEGA para TransactionRegistrationService
   */
  async processImageMessage(
    phoneNumber: string,
    imageBuffer: Buffer,
    mimeType: string,
    messageId: string,
    platform: 'whatsapp' | 'telegram' = 'whatsapp',
  ): Promise<ProcessMessageResult> {
    try {
      this.logger.log(`🖼️ [Orchestrator] Processando imagem de ${phoneNumber}`);

      const user = await this.userCache.getUser(phoneNumber);
      if (!user) {
        return {
          success: false,
          message: '❌ Usuário não encontrado.',
          requiresConfirmation: false,
        };
      }

      // Verificar se há confirmação pendente (bloqueio de contexto)
      const hasPending = await this.confirmationService.getPendingConfirmation(phoneNumber);
      if (hasPending) {
        this.logger.log(`⏸️  Usuário tem confirmação pendente - bloqueando nova imagem`);

        const blockMessage =
          '⏸️  *Você tem uma transação aguardando confirmação!*\n\n' +
          'Por favor, primeiro responda:\n' +
          '✅ Digite *"sim"* para confirmar\n' +
          '❌ Digite *"não"* para cancelar\n\n' +
          '💡 Ou digite *"pendentes"* para ver detalhes';

        this.emitReply(phoneNumber, blockMessage, platform, 'CONFIRMATION_REQUEST', {
          hasPending: true,
          confirmationId: hasPending.id,
        });

        return {
          success: false,
          message: blockMessage,
          requiresConfirmation: true,
          confirmationId: hasPending.id,
        };
      }

      // ✨ FEEDBACK IMEDIATO: Avisar que está analisando a imagem
      const processingMessage =
        '🖼️ *Analisando sua imagem...*\n\n' +
        '🤖 Estou extraindo as informações da nota fiscal.\n' +
        '_Isso pode levar alguns segundos._';

      this.emitReply(phoneNumber, processingMessage, platform, 'INTENT_RESPONSE', {
        processing: true,
        type: 'image',
      });

      // DELEGAR para serviço especializado de REGISTRO
      const result = await this.registrationService.processImageTransaction(
        phoneNumber,
        imageBuffer,
        mimeType,
        messageId,
        user,
        platform, // Passar platform da mensagem
      );

      // Emitir resposta se houver mensagem
      if (result.message) {
        const context = result.requiresConfirmation ? 'CONFIRMATION_REQUEST' : 'TRANSACTION_RESULT';
        this.emitReply(phoneNumber, result.message, platform, context, {
          success: result.success,
          confirmationId: result.confirmationId,
        });
      }

      return { ...result, platform };
    } catch (error) {
      this.logger.error(`❌ Erro ao processar imagem:`, error);
      return {
        success: false,
        message: '❌ Erro ao processar imagem.',
        requiresConfirmation: false,
      };
    }
  }

  /**
   * Processa mensagem de áudio
   * DELEGA para TransactionRegistrationService
   */
  async processAudioMessage(
    phoneNumber: string,
    audioBuffer: Buffer,
    mimeType: string,
    messageId: string,
    platform: 'whatsapp' | 'telegram' = 'whatsapp',
  ): Promise<ProcessMessageResult> {
    try {
      this.logger.log(`🎤 [Orchestrator] Processando áudio de ${phoneNumber}`);

      const user = await this.userCache.getUser(phoneNumber);
      if (!user) {
        return {
          success: false,
          message: '❌ Usuário não encontrado.',
          requiresConfirmation: false,
        };
      }

      // Verificar se há confirmação pendente (bloqueio de contexto)
      const hasPending = await this.confirmationService.getPendingConfirmation(phoneNumber);
      if (hasPending) {
        this.logger.log(`⏸️  Usuário tem confirmação pendente - bloqueando novo áudio`);

        const blockMessage =
          '⏸️  *Você tem uma transação aguardando confirmação!*\n\n' +
          'Por favor, primeiro responda:\n' +
          '✅ Digite *"sim"* para confirmar\n' +
          '❌ Digite *"não"* para cancelar\n\n' +
          '💡 Ou digite *"pendentes"* para ver detalhes';

        this.emitReply(phoneNumber, blockMessage, platform, 'CONFIRMATION_REQUEST', {
          hasPending: true,
          confirmationId: hasPending.id,
        });

        return {
          success: false,
          message: blockMessage,
          requiresConfirmation: true,
          confirmationId: hasPending.id,
        };
      }

      // ✨ FEEDBACK IMEDIATO: Avisar que está transcrevendo o áudio
      const processingMessage =
        '🎤 *Processando seu áudio...*\n\n' +
        '🤖 Estou transcrevendo e analisando a mensagem.\n' +
        '_Aguarde um momento._';

      this.emitReply(phoneNumber, processingMessage, platform, 'INTENT_RESPONSE', {
        processing: true,
        type: 'audio',
      });

      // DELEGAR para serviço especializado de REGISTRO
      const result = await this.registrationService.processAudioTransaction(
        phoneNumber,
        audioBuffer,
        mimeType,
        messageId,
        user,
        platform, // Passar platform da mensagem
      );

      // Emitir resposta se houver mensagem
      if (result.message) {
        const context = result.requiresConfirmation ? 'CONFIRMATION_REQUEST' : 'TRANSACTION_RESULT';
        this.emitReply(phoneNumber, result.message, platform, context, {
          success: result.success,
          confirmationId: result.confirmationId,
        });
      }

      return { ...result, platform };
    } catch (error) {
      this.logger.error(`❌ Erro ao processar áudio:`, error);
      return {
        success: false,
        message: '❌ Erro ao processar áudio.',
        requiresConfirmation: false,
      };
    }
  }

  /**
   * Processa confirmação de transação (sim/não)
   * DELEGA for TransactionConfirmationService
   */
  async processConfirmation(
    phoneNumber: string,
    response: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      this.logger.log(`✅ [Orchestrator] Processando confirmação: ${response}`);

      // DELEGAR para serviço de confirmações
      const result = await this.confirmationService.processResponse(phoneNumber, response);

      if (result.action === 'invalid') {
        return {
          success: false,
          message: '❓ Não há transação pendente de confirmação.',
        };
      }

      if (result.action === 'rejected') {
        return {
          success: true,
          message: '❌ Ok, transação cancelada.',
        };
      }

      if (result.action === 'confirmed' && result.confirmation) {
        // Delegar registro final para TransactionRegistrationService
        return await this.registrationService.registerConfirmedTransaction(result.confirmation);
      }

      return {
        success: false,
        message: '❓ Não entendi sua resposta. Por favor, responda com "sim" ou "não".',
      };
    } catch (error) {
      this.logger.error('Erro ao processar confirmação:', error);
      return {
        success: false,
        message: '❌ Erro ao processar confirmação. Tente novamente.',
      };
    }
  }

  /**
   * Lista transações pendentes de confirmação
   */
  async listPendingConfirmations(
    phoneNumber: string,
  ): Promise<{ success: boolean; message: string }> {
    try {
      this.logger.log(`📋 [Orchestrator] Listando confirmações pendentes de ${phoneNumber}`);

      const pending = await this.confirmationService.getAllPendingConfirmations(phoneNumber);

      if (!pending || pending.length === 0) {
        return {
          success: true,
          message: '✅ Você não tem transações pendentes de confirmação.',
        };
      }

      const { DateUtil } = await import('../../utils/date.util');

      let message = `📋 *Transações Pendentes de Confirmação*\n\n`;
      message += `Você tem ${pending.length} transação(ões) aguardando:\n\n`;

      pending.forEach((conf, index) => {
        const typeEmoji = conf.type === 'EXPENSES' ? '💸' : '💰';
        const amount = (Number(conf.amount) / 100).toFixed(2);
        const extractedData = conf.extractedData as any;

        message += `${index + 1}. ${typeEmoji} *R$ ${amount}*\n`;
        message += `   📂 ${conf.category}\n`;
        if (extractedData?.merchant) {
          message += `   🏪 ${extractedData.merchant}\n`;
        }
        message += `   📅 ${DateUtil.formatBR(conf.date)}\n\n`;
      });

      message += `💡 *Digite "sim" para confirmar a primeira, ou "não" para cancelar.*`;

      return {
        success: true,
        message,
      };
    } catch (error) {
      this.logger.error('Erro ao listar pendentes:', error);
      return {
        success: false,
        message: '❌ Erro ao buscar transações pendentes.',
      };
    }
  }

  /**
   * Lista transações do usuário
   */
  async listTransactions(phoneNumber: string, filters?: any) {
    try {
      const user = await this.userCache.getUser(phoneNumber);
      if (!user) {
        return {
          success: false,
          message: '❌ Usuário não encontrado.',
        };
      }
      return await this.listingService.listTransactions(user, filters);
    } catch (error) {
      this.logger.error('Erro ao listar transações:', error);
      return {
        success: false,
        message: '❌ Erro ao listar transações.',
      };
    }
  }

  /**
   * Busca saldo do usuário
   */
  async getBalance(phoneNumber: string) {
    try {
      const user = await this.userCache.getUser(phoneNumber);
      if (!user) {
        return {
          success: false,
          message: '❌ Usuário não encontrado.',
        };
      }

      // Implementar busca de saldo na API GastoCerto
      return {
        success: true,
        message: '💰 Consultando saldo...',
        balance: 0,
      };
    } catch (error) {
      this.logger.error('Erro ao buscar saldo:', error);
      return {
        success: false,
        message: '❌ Erro ao buscar saldo.',
      };
    }
  }

  /**
   * Processa pagamento
   */
  async processPayment(phoneNumber: string, message: string) {
    try {
      const user = await this.userCache.getUser(phoneNumber);
      if (!user) {
        return {
          success: false,
          message: '❌ Usuário não encontrado.',
        };
      }

      // TODO: Extrair intenção da mensagem e criar PaymentRequest apropriado
      // Por ora, retorna lista de pendentes
      return await this.paymentService.processPayment(user, {
        paymentType: 'pending_list',
      });
    } catch (error) {
      this.logger.error('Erro ao processar pagamento:', error);
      return {
        success: false,
        message: '❌ Erro ao processar pagamento.',
      };
    }
  }

  /**
   * Gera resumo financeiro
   */
  async getSummary(phoneNumber: string) {
    try {
      const user = await this.userCache.getUser(phoneNumber);
      if (!user) {
        return {
          success: false,
          message: '❌ Usuário não encontrado.',
        };
      }
      return await this.summaryService.generateSummary(user, {
        summaryType: 'monthly',
      });
    } catch (error) {
      this.logger.error('Erro ao gerar resumo:', error);
      return {
        success: false,
        message: '❌ Erro ao gerar resumo.',
      };
    }
  }
}
