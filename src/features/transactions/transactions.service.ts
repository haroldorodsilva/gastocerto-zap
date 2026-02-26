import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UserCache } from '@prisma/client';
import { UserCacheService } from '@features/users/user-cache.service';
import { IntentAnalyzerService } from '@features/intent/intent-analyzer.service';
import { AccountManagementService } from '@features/accounts/account-management.service';
import { SecurityService } from '@features/security/security.service';
import { TransactionRegistrationService } from './contexts/registration/registration.service';
import { TransactionListingService } from './contexts/listing/listing.service';
import { TransactionPaymentService } from './contexts/payment/payment.service';
import { TransactionSummaryService } from './contexts/summary/summary.service';
import { TransactionConfirmationService } from './transaction-confirmation.service';
import { ListContextService } from './list-context.service';
import { CreditCardService } from '../credit-cards/credit-card.service';

export interface ProcessMessageResult {
  success: boolean;
  message: string;
  requiresConfirmation: boolean;
  confirmationId?: string;
  autoRegistered?: boolean;
  platform?: 'whatsapp' | 'telegram' | 'webchat';
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
    private readonly creditCardService: CreditCardService,
    private readonly listContext: ListContextService,
  ) {
    this.logger.log('🎯 TransactionsService (Orchestrator) inicializado');
  }

  /**
   * ✨ Helper para emitir eventos de resposta para a plataforma correta
   */
  private emitReply(
    phoneNumber: string,
    message: string,
    platform: 'whatsapp' | 'telegram' | 'webchat',
    context: 'INTENT_RESPONSE' | 'CONFIRMATION_REQUEST' | 'TRANSACTION_RESULT' | 'ERROR',
    metadata?: any,
    platformId?: string,
  ): void {
    const targetId = platformId || phoneNumber;
    // Mapear plataforma para evento correto
    const eventNameMap: Record<string, string> = {
      telegram: 'telegram.reply',
      whatsapp: 'whatsapp.reply',
      webchat: 'whatsapp.reply', // WebChat HTTP não usa eventos, mas emite para log/rastreabilidade
    };
    const eventName = eventNameMap[platform] || 'whatsapp.reply';

    this.logger.debug(`📤 Emitindo evento ${eventName} para ${phoneNumber}`);

    this.eventEmitter.emit(eventName, {
      platformId: targetId,
      message,
      context,
      metadata,
      platform,
    });
  }

  /**
   * Processa mensagem de texto e extrai transação
   * DELEGA para TransactionRegistrationService
   * @param user - Objeto UserCache completo (já buscado pelo provedor)
   * @param text - Texto da mensagem
   * @param messageId - ID único da mensagem
   * @param platform - Plataforma de origem (whatsapp|telegram|webchat)
   * @param platformId - ID específico da plataforma (chatId, número, etc)
   * @param accountId - ID da conta a ser usada (contextual por canal)
   */
  async processTextMessage(
    user: UserCache,
    text: string,
    messageId: string,
    platform: 'whatsapp' | 'telegram' | 'webchat' = 'whatsapp',
    platformId?: string,
    accountId?: string,
  ): Promise<ProcessMessageResult> {
    try {
      const phoneNumber = user.phoneNumber; // Para compatibilidade com código existente
      
      // Usar accountId passado ou fallback para user.activeAccountId
      const activeAccountId = accountId || user.activeAccountId;
      
      this.logger.log(
        `📝 [Orchestrator] Processando texto de ${phoneNumber} | Platform: ${platform} | UserId: ${user.id} | AccountId: ${activeAccountId}`,
      );

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

      // Log do activeAccountId do cache para debug
      this.logger.log(
        `👤 User: ${user.phoneNumber} | gastoCertoId: ${user.gastoCertoId} | activeAccountId (cache): ${user.activeAccountId} | accountId (usado): ${activeAccountId}`,
      );

      // 1.5. VERIFICAR REFERÊNCIA NUMÉRICA DE LISTA ("pagar 5", "pagar item 3")
      const listReference = this.detectListReference(text);
      if (listReference.found && listReference.number) {
        this.logger.log(
          `🔢 Referência de lista detectada: "${listReference.action}" #${listReference.number}`,
        );

        // Processar ação baseada no contexto da lista
        const result = await this.processListReference(
          user,
          listReference.action,
          listReference.number,
          platform,
        );

        if (result) {
          this.emitReply(phoneNumber, result.message, platform, 'TRANSACTION_RESULT', {
            success: result.success,
          }, platformId);

          return {
            success: result.success,
            message: result.message,
            requiresConfirmation: false,
          };
        }
      }

      // 2. Analisar intenção com NLP
      // Usar platformId real (chatId do Telegram, número do WhatsApp, etc) ao invés de user.phoneNumber
      const actualPhoneNumber = platformId || phoneNumber;
      const intentResult = await this.intentAnalyzer.analyzeIntent(text, actualPhoneNumber, user.id);

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
          'LIST_PENDING_PAYMENTS',
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
          }, platformId);

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
        }, platformId);

        return {
          success: true,
          message: responseMessage,
          requiresConfirmation: false,
        };
      }

      // 2.5. VALIDAÇÃO CENTRALIZADA DE CONTA ATIVA
      // Operações que NÃO precisam de conta ativa (podem ser executadas sem)
      const operationsWithoutAccountRequired = [
        'LIST_ACCOUNTS', // Listar contas disponíveis
        'SHOW_ACTIVE_ACCOUNT', // Mostrar qual conta está ativa
        'SWITCH_ACCOUNT', // Trocar de conta
        'CONFIRMATION_RESPONSE', // Confirmar transação
        'HELP', // Ajuda
        'GREETING', // Saudações
      ];

      if (!operationsWithoutAccountRequired.includes(intentResult.intent)) {
        this.logger.log(`🔐 Validando conta ativa para operação: ${intentResult.intent}`);

        const accountValidation = await this.accountManagement.validateActiveAccount(phoneNumber);

        if (!accountValidation.valid) {
          this.logger.warn(`❌ Operação bloqueada - sem conta ativa: ${intentResult.intent}`);

          this.emitReply(phoneNumber, accountValidation.message || '', platform, 'ERROR', {
            reason: 'no_active_account',
          }, platformId);

          return {
            success: false,
            message: accountValidation.message || '❌ Você não possui um perfil ativo.',
            requiresConfirmation: false,
          };
        }

        this.logger.log(
          `✅ Conta ativa validada: ${accountValidation.account?.name} (${accountValidation.account?.id})`,
        );
      }

      // 3. ROTEAMENTO por intent
      // 3a. Confirmação de transação (sim/não)
      if (intentResult.intent === 'CONFIRMATION_RESPONSE') {
        this.logger.log(`✅ Delegando para processConfirmation`);
        const confirmResult = await this.processConfirmation(phoneNumber, text);

        this.emitReply(phoneNumber, confirmResult.message, platform, 'TRANSACTION_RESULT', {
          success: confirmResult.success,
        }, platformId);

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
          }, platformId);

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
        }, platformId);

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
        }, platformId);

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
        }, platformId);

        return {
          success: result.success,
          message: result.message,
          requiresConfirmation: result.requiresConfirmation || false,
        };
      }

      // 3e. Listar transações pendentes de CONFIRMAÇÃO
      if (intentResult.intent === 'LIST_PENDING') {
        this.logger.log(`✅ Delegando para listPendingConfirmations`);
        const listResult = await this.listPendingConfirmations(phoneNumber);

        this.emitReply(phoneNumber, listResult.message, platform, 'TRANSACTION_RESULT', {
          success: listResult.success,
        }, platformId);

        return {
          success: listResult.success,
          message: listResult.message,
          requiresConfirmation: false,
        };
      }

      // 3e.1. Listar contas pendentes de PAGAMENTO
      if (intentResult.intent === 'LIST_PENDING_PAYMENTS') {
        this.logger.log(`✅ Delegando para TransactionPaymentService.listPendingPayments`);
        const result = await this.paymentService.processPayment(user, {
          paymentType: 'pending_list',
        });

        this.emitReply(phoneNumber, result.message, platform, 'TRANSACTION_RESULT', {
          success: result.success,
        }, platformId);

        return {
          success: result.success,
          message: result.message,
          requiresConfirmation: false,
        };
      }

      // 3e.2. Pagar fatura/conta (PAY_BILL)
      if (intentResult.intent === 'PAY_BILL') {
        this.logger.log(`✅ Delegando para TransactionPaymentService.processPayment`);
        // Por padrão, lista pendentes (usuário pode escolher qual pagar)
        const result = await this.paymentService.processPayment(user, {
          paymentType: 'pending_list',
        });

        this.emitReply(phoneNumber, result.message, platform, 'TRANSACTION_RESULT', {
          success: result.success,
        }, platformId);

        return {
          success: result.success,
          message: result.message,
          requiresConfirmation: false,
        };
      }

      // 3f. Consultar saldo
      if (intentResult.intent === 'CHECK_BALANCE') {
        this.logger.log(`✅ Delegando para TransactionSummaryService.generateBalanceSummary`);
        const result = await this.summaryService.generateSummary(user, { summaryType: 'balance' });

        this.emitReply(phoneNumber, result.message, platform, 'INTENT_RESPONSE', {
          success: result.success,
        }, platformId);

        return {
          success: result.success,
          message: result.message,
          requiresConfirmation: false,
        };
      }

      // 3g. Cartões de crédito
      // 3g.1. Listar cartões
      if (intentResult.intent === 'LIST_CREDIT_CARDS') {
        this.logger.log(`✅ Delegando para CreditCardService.listCreditCards`);
        const result = await this.creditCardService.listCreditCards(user);

        this.emitReply(phoneNumber, result.message, platform, 'INTENT_RESPONSE', {
          success: result.success,
        }, platformId);

        return {
          success: result.success,
          message: result.message,
          requiresConfirmation: false,
        };
      }

      // 3g.2. Definir cartão padrão
      if (intentResult.intent === 'SET_DEFAULT_CREDIT_CARD') {
        this.logger.log(`✅ Delegando para CreditCardService.setDefaultCreditCard`);
        const result = await this.creditCardService.setDefaultCreditCard(user, text);

        this.emitReply(phoneNumber, result.message, platform, 'INTENT_RESPONSE', {
          success: result.success,
        }, platformId);

        return {
          success: result.success,
          message: result.message,
          requiresConfirmation: false,
        };
      }

      // 3g.3. Mostrar cartão padrão
      if (intentResult.intent === 'SHOW_DEFAULT_CREDIT_CARD') {
        this.logger.log(`✅ Delegando para CreditCardService.showDefaultCreditCard`);
        const result = await this.creditCardService.showDefaultCreditCard(user);

        this.emitReply(phoneNumber, result.message, platform, 'INTENT_RESPONSE', {
          success: result.success,
        }, platformId);

        return {
          success: result.success,
          message: result.message,
          requiresConfirmation: false,
        };
      }

      // 3g.4. Ver fatura por nome do cartão
      if (intentResult.intent === 'SHOW_INVOICE_BY_CARD_NAME') {
        this.logger.log(`✅ Delegando para CreditCardService.showInvoiceByCardName`);
        const result = await this.creditCardService.showInvoiceByCardName(user, text);

        this.emitReply(phoneNumber, result.message, platform, 'INTENT_RESPONSE', {
          success: result.success,
        }, platformId);

        return {
          success: result.success,
          message: result.message,
          requiresConfirmation: false,
        };
      }

      // 3g.5. Listar faturas
      if (intentResult.intent === 'LIST_INVOICES') {
        this.logger.log(`✅ Delegando para CreditCardService.listInvoices`);
        const result = await this.creditCardService.listInvoices(user);

        this.emitReply(phoneNumber, result.message, platform, 'INTENT_RESPONSE', {
          success: result.success,
        }, platformId);

        return {
          success: result.success,
          message: result.message,
          requiresConfirmation: false,
        };
      }

      // 3g.6. Detalhes de fatura (context-aware)
      if (intentResult.intent === 'SHOW_INVOICE_DETAILS') {
        this.logger.log(`✅ Delegando para CreditCardService.showInvoiceDetails`);
        // TODO: Extrair número da fatura da mensagem (ex: "ver fatura 1")
        // Por ora, retornar mensagem pedindo número
        const result = {
          success: false,
          message:
            '💡 Para ver detalhes de uma fatura, primeiro liste as faturas com:\n' +
            '*"minhas faturas"*\n\n' +
            'Depois use: *"ver fatura 1"* (substituindo 1 pelo número da fatura)',
        };

        this.emitReply(phoneNumber, result.message, platform, 'INTENT_RESPONSE', {
          success: result.success,
        }, platformId);

        return {
          success: result.success,
          message: result.message,
          requiresConfirmation: false,
        };
      }

      // 3g.7. Pagar fatura (context-aware)
      if (intentResult.intent === 'PAY_INVOICE') {
        this.logger.log(`✅ Delegando para CreditCardService.payInvoice`);
        // TODO: Extrair número da fatura da mensagem (ex: "pagar fatura 1")
        const result = {
          success: false,
          message:
            '💡 Para pagar uma fatura, primeiro liste as faturas com:\n' +
            '*"minhas faturas"*\n\n' +
            'Depois use: *"pagar fatura 1"* (substituindo 1 pelo número da fatura)',
        };

        this.emitReply(phoneNumber, result.message, platform, 'INTENT_RESPONSE', {
          success: result.success,
        }, platformId);

        return {
          success: result.success,
          message: result.message,
          requiresConfirmation: false,
        };
      }

      // 3h. Listar transações
      if (intentResult.intent === 'LIST_TRANSACTIONS') {
        this.logger.log(`✅ Delegando para TransactionListingService.listTransactions`);
        const result = await this.listingService.listTransactions(user, {
          period: 'month', // Padrão: mês atual
          limit: 100, //TODO: Fazer paginação futura
        });

        this.emitReply(phoneNumber, result.message, platform, 'INTENT_RESPONSE', {
          success: result.success,
        }, platformId);

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
        activeAccountId, // Passar accountId contextual
      );

      // 4. Emitir resposta se houver mensagem
      if (result.message) {
        const context = result.requiresConfirmation ? 'CONFIRMATION_REQUEST' : 'TRANSACTION_RESULT';
        this.emitReply(phoneNumber, result.message, platform, context, {
          success: result.success,
          confirmationId: result.confirmationId,
        }, platformId);
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
    user: UserCache,
    imageBuffer: Buffer,
    mimeType: string,
    messageId: string,
    platform: 'whatsapp' | 'telegram' | 'webchat' = 'whatsapp',
    platformId?: string,
    accountId?: string,
  ): Promise<ProcessMessageResult> {
    try {
      const phoneNumber = user.phoneNumber; // Para compatibilidade
      const activeAccountId = accountId || user.activeAccountId;
      this.logger.log(`🖼️ [Orchestrator] Processando imagem de ${phoneNumber} | UserId: ${user.id} | AccountId: ${activeAccountId}`);


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
        }, platformId);

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
      }, platformId);

      // DELEGAR para serviço especializado de REGISTRO
      const result = await this.registrationService.processImageTransaction(
        phoneNumber,
        imageBuffer,
        mimeType,
        messageId,
        user,
        platform, // Passar platform da mensagem
        activeAccountId, // Passar accountId contextual
      );

      // Emitir resposta se houver mensagem
      if (result.message) {
        const context = result.requiresConfirmation ? 'CONFIRMATION_REQUEST' : 'TRANSACTION_RESULT';
        this.emitReply(phoneNumber, result.message, platform, context, {
          success: result.success,
          confirmationId: result.confirmationId,
        }, platformId);
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
    user: UserCache,
    audioBuffer: Buffer,
    mimeType: string,
    messageId: string,
    platform: 'whatsapp' | 'telegram' | 'webchat' = 'whatsapp',
    platformId?: string,
    accountId?: string,
  ): Promise<ProcessMessageResult> {
    try {
      const phoneNumber = user.phoneNumber; // Para compatibilidade
      const activeAccountId = accountId || user.activeAccountId;
      this.logger.log(`🎤 [Orchestrator] Processando áudio de ${phoneNumber} | UserId: ${user.id} | AccountId: ${activeAccountId}`);


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
        }, platformId);

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
      }, platformId);

      // DELEGAR para serviço especializado de REGISTRO
      const result = await this.registrationService.processAudioTransaction(
        phoneNumber,
        audioBuffer,
        mimeType,
        messageId,
        user,
        platform, // Passar platform da mensagem
        activeAccountId, // Passar accountId contextual
      );

      // Emitir resposta se houver mensagem
      if (result.message) {
        const context = result.requiresConfirmation ? 'CONFIRMATION_REQUEST' : 'TRANSACTION_RESULT';
        this.emitReply(phoneNumber, result.message, platform, context, {
          success: result.success,
          confirmationId: result.confirmationId,
        }, platformId);
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

  /**
   * Detecta referência numérica em lista
   * Exemplos: "pagar 5", "ver fatura 2", "pagar fatura 1", "5", "item 1"
   */
  private detectListReference(text: string): {
    found: boolean;
    action?: string;
    number?: number;
  } {
    const normalized = text.toLowerCase().trim();

    // Padrões de ação + número
    const patterns = [
      /(?:ver|mostrar|detalhes)\s+(?:fatura|invoice)\s+(\d+)/i, // "ver fatura 1"
      /(?:pagar|quitar)\s+(?:fatura|invoice)\s+(\d+)/i, // "pagar fatura 1"
      /(?:pagar|paga|quitar|marcar)\s+(?:o\s+)?(?:item\s+)?(?:n[uú]mero\s+)?(\d+)/i,
      /(?:pagar|paga|quitar|marcar)\s+(\d+)/i,
      /^(\d+)$/, // Apenas número
    ];

    for (const pattern of patterns) {
      const match = normalized.match(pattern);
      if (match) {
        const number = parseInt(match[1], 10);

        // Determinar ação
        let action = 'pay'; // Padrão: pagar

        if (
          normalized.includes('ver') ||
          normalized.includes('mostrar') ||
          normalized.includes('detalhes')
        ) {
          action = 'view';
        } else if (
          normalized.includes('pagar') ||
          normalized.includes('paga') ||
          normalized.includes('quitar')
        ) {
          action = 'pay';
        }

        return {
          found: true,
          action,
          number,
        };
      }
    }

    return { found: false };
  }

  /**
   * Processa referência de lista baseado no contexto
   */
  private async processListReference(
    user: UserCache,
    action: string,
    itemNumber: number,
    platform: string,
  ): Promise<{ success: boolean; message: string } | null> {
    try {
      // Buscar contexto do usuário
      const context = this.listContext.getContext(user.phoneNumber);

      if (!context) {
        // Sem contexto - retornar null para processar normalmente
        return null;
      }

      this.logger.log(
        `📝 Contexto encontrado: ${context.listType} com ${context.items.length} itens`,
      );

      // Processar baseado no tipo de lista
      switch (context.listType) {
        case 'pending_payments':
          // Pagar item da lista de pendentes
          if (action === 'pay') {
            return await this.paymentService.payItemByNumber(user, itemNumber);
          }
          break;

        case 'invoices':
          // Ações em faturas de cartão
          if (action === 'view') {
            return await this.creditCardService.showInvoiceDetails(user, itemNumber);
          } else if (action === 'pay') {
            return await this.creditCardService.payInvoice(user, itemNumber);
          }
          break;

        case 'transactions':
          // Futura implementação: ações em transações da lista
          return {
            success: false,
            message:
              '⚠️ Ação em transações ainda não implementada.\n\n' +
              'Use *"ver pendentes"* para listar contas que podem ser pagas.',
          };

        case 'confirmations':
          // Futura implementação: confirmar item específico da lista
          return {
            success: false,
            message: '⚠️ Para confirmar transações, use *"sim"* ou *"não"*.',
          };
      }

      return null;
    } catch (error) {
      this.logger.error('Erro ao processar referência de lista:', error);
      return {
        success: false,
        message: '❌ Erro ao processar sua solicitação.',
      };
    }
  }
}
