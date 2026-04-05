import { Inject, Injectable, Logger } from '@nestjs/common';
import { UserCache } from '@prisma/client';
import { UserCacheService } from '@features/users/user-cache.service';
import { IntentAnalyzerService, IntentAnalysisResult, MessageIntent } from '@features/intent/intent-analyzer.service';
import { AccountManagementService } from '@features/accounts/account-management.service';
import { SecurityService } from '@features/security/security.service';
import { ConversationMemoryService } from '@features/conversation/conversation-memory.service';
import { DisambiguationService } from '@features/conversation/disambiguation.service';
import { getPostActionSuggestion } from '@shared/utils/response-variations';
import { TransactionRegistrationService } from './contexts/registration/registration.service';
import { TransactionListingService } from './contexts/listing/listing.service';
import { TransactionPaymentService } from './contexts/payment/payment.service';
import { TransactionSummaryService } from './contexts/summary/summary.service';
import { TransactionConfirmationService } from './transaction-confirmation.service';
import { ListContextService } from './list-context.service';
import { CreditCardService } from '../credit-cards/credit-card.service';
import { PlatformReplyService } from '@infrastructure/messaging/messages/platform-reply.service';
import {
  IntentHandler,
  IntentHandlerContext,
  INTENT_HANDLERS,
} from './intent-handlers';

// Re-export para backward compatibility
export { ProcessMessageResult } from './transactions.types';
import { ProcessMessageResult } from './transactions.types';

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
  private readonly intentHandlerMap = new Map<string, IntentHandler>();

  constructor(
    private readonly userCache: UserCacheService,
    private readonly intentAnalyzer: IntentAnalyzerService,
    private readonly accountManagement: AccountManagementService,
    private readonly securityService: SecurityService,
    private readonly platformReply: PlatformReplyService,
    private readonly registrationService: TransactionRegistrationService,
    private readonly listingService: TransactionListingService,
    private readonly paymentService: TransactionPaymentService,
    private readonly summaryService: TransactionSummaryService,
    private readonly confirmationService: TransactionConfirmationService,
    private readonly creditCardService: CreditCardService,
    private readonly listContext: ListContextService,
    private readonly conversationMemory: ConversationMemoryService,
    private readonly disambiguationService: DisambiguationService,
    @Inject(INTENT_HANDLERS) intentHandlers: IntentHandler[],
  ) {
    // Construir mapa de despacho: MessageIntent → IntentHandler
    for (const handler of intentHandlers) {
      for (const intent of handler.supportedIntents) {
        this.intentHandlerMap.set(intent, handler);
      }
    }
    this.logger.log(
      `🎯 TransactionsService (Orchestrator) inicializado | ${this.intentHandlerMap.size} intents mapeados`,
    );
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
    imageBuffer?: Buffer,
  ): void {
    const targetId = platformId || phoneNumber;

    // Delegar para PlatformReplyService (centralizado)
    void this.platformReply.sendReply({
      platformId: targetId,
      message,
      context,
      platform,
      metadata,
      imageBuffer,
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

      // Se accountId foi fornecido (ex: webchat x-account header) mas o cache não tem,
      // atualizar o cache para que todos os services downstream usem a conta correta
      if (accountId && user.activeAccountId !== accountId) {
        this.logger.log(
          `🔄 [Orchestrator] Atualizando activeAccountId no cache: ${user.activeAccountId} → ${accountId}`,
        );
        await this.userCache.updateUserCache(user.gastoCertoId, {
          activeAccountId: accountId,
        } as any);
        user.activeAccountId = accountId;
      }
      
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

      // 1.4. SELEÇÃO DE CARTÃO POR CONTEXTO (após "meus cartões")
      // Intercept bare numbers and "usar X" when credit_cards list context is active,
      // before generic list-reference and intent analysis overwrite it.
      const activeListCtx = this.listContext.getContext(user.phoneNumber);
      if (activeListCtx?.listType === 'credit_cards') {
        const bareNumMatch = text.trim().match(/^(\d+)$/);
        const useNameMatch = text.trim().match(/^usar\s+(.+)$/i);
        if (bareNumMatch || useNameMatch) {
          let cardMessage: string;
          if (bareNumMatch) {
            const idx = parseInt(bareNumMatch[1], 10) - 1;
            const cardItem = activeListCtx.items[idx];
            cardMessage = cardItem ? `usar cartão ${cardItem.description}` : text;
          } else {
            cardMessage = text; // "usar nubank" — setDefaultCreditCard already extracts by name
          }
          this.logger.log(`💳 Seleção de cartão pelo contexto: "${cardMessage}"`);
          const cardResult = await this.creditCardService.setDefaultCreditCard(user, cardMessage);
          // Só limpar contexto se conseguiu definir o cartão; se falhou (ex: lista mostrada de novo)
          // mantemos o contexto para o próximo número/nome do usuário
          if (cardResult.success) {
            this.listContext.clearContext(user.phoneNumber);
          }
          this.emitReply(phoneNumber, cardResult.message, platform, 'INTENT_RESPONSE', {
            success: cardResult.success,
          }, platformId);
          return {
            success: cardResult.success,
            message: cardResult.message,
            requiresConfirmation: false,
          };
        }
      }

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
      // Salvar mensagem do usuário na memória de conversa
      void this.conversationMemory.addEntry(phoneNumber, { role: 'user', text });

      // 1.6. VERIFICAR DESAMBIGUAÇÃO PENDENTE ("1", "2", "3")
      const resolvedIntent = await this.disambiguationService.resolveNumericResponse(phoneNumber, text);
      if (resolvedIntent) {
        this.logger.log(`🔢 Desambiguação resolvida: ${resolvedIntent}`);

        // Converter string de intent para IntentAnalysisResult e processar normalmente
        const intentResult: IntentAnalysisResult = {
          intent: resolvedIntent as MessageIntent,
          confidence: 0.9,
          shouldProcess: true,
        };

        // Salvar resposta do bot na memória
        void this.conversationMemory.addEntry(phoneNumber, {
          role: 'bot',
          text: `[desambiguação → ${resolvedIntent}]`,
          intent: resolvedIntent,
        });

        // Despachar para o handler correto
        const handler = this.intentHandlerMap.get(resolvedIntent);
        if (handler) {
          const ctx: IntentHandlerContext = { user, text, messageId, platform, platformId, accountId: activeAccountId, phoneNumber, intentResult };
          return handler.handle(ctx);
        }
      }

      // Usar platformId real (chatId do Telegram, número do WhatsApp, etc) ao invés de user.phoneNumber
      const actualPhoneNumber = platformId || phoneNumber;
      let intentResult = await this.intentAnalyzer.analyzeIntent(text, actualPhoneNumber, user.id);

      // 2.1. Follow-up contextual: se UNKNOWN, tentar resolver com memória de conversa
      if (intentResult.intent === 'UNKNOWN') {
        const resolved = await this.tryContextualFollowUp(phoneNumber, text, intentResult);
        if (resolved) {
          intentResult = resolved;
          this.logger.log(`🔗 Follow-up contextual resolvido: ${intentResult.intent}`);
        }
      }

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

        // Salvar resposta do bot na memória
        void this.conversationMemory.addEntry(phoneNumber, {
          role: 'bot',
          text: responseMessage,
          intent: intentResult.intent,
        });

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

      // 3. ROTEAMENTO por intent (Strategy Pattern)
      // 3a. CONTEXTO: Seleção numérica de conta (1, 2, 3)
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

      // 3b. Despacho via Strategy Pattern (IntentHandler map)
      const handler = this.intentHandlerMap.get(intentResult.intent);

      if (handler) {
        const ctx: IntentHandlerContext = {
          user,
          text,
          messageId,
          platform,
          platformId,
          accountId: activeAccountId,
          phoneNumber,
          intentResult,
        };

        const result = await handler.handle(ctx);

        // Adicionar sugestão pós-ação (se sucesso e não requer confirmação)
        if (result.success && !result.requiresConfirmation && result.message) {
          const suggestion = getPostActionSuggestion(intentResult.intent);
          if (suggestion) {
            result.message = result.message + '\n\n' + suggestion;
          }
        }

        // Salvar resposta do bot na memória
        if (result.message) {
          void this.conversationMemory.addEntry(phoneNumber, {
            role: 'bot',
            text: result.message,
            intent: intentResult.intent,
          });
        }

        if (result.message) {
          const replyContext = result.replyContext ||
            (result.requiresConfirmation ? 'CONFIRMATION_REQUEST' : 'TRANSACTION_RESULT');
          this.emitReply(phoneNumber, result.message, platform, replyContext, {
            success: result.success,
            confirmationId: result.confirmationId,
          }, platformId, result.imageBuffer);
        }

        return { ...result, platform };
      }

      // 3c. Fallback: registrar transação (intent não mapeado)
      this.logger.log(`✅ Fallback: Delegando para TransactionRegistrationService`);
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
   * Processa documento PDF e extrai transação(ões)
   * DELEGA para TransactionRegistrationService
   */
  async processDocumentMessage(
    user: UserCache,
    documentBuffer: Buffer,
    mimeType: string,
    fileName: string,
    messageId: string,
    platform: 'whatsapp' | 'telegram' | 'webchat' = 'whatsapp',
    platformId?: string,
    accountId?: string,
  ): Promise<ProcessMessageResult> {
    try {
      const phoneNumber = user.phoneNumber;
      const activeAccountId = accountId || user.activeAccountId;
      this.logger.log(
        `📄 [Orchestrator] Processando documento "${fileName}" de ${phoneNumber} | AccountId: ${activeAccountId}`,
      );

      // Verificar se há confirmação pendente
      const hasPending = await this.confirmationService.getPendingConfirmation(phoneNumber);
      if (hasPending) {
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

      // Feedback imediato
      const processingMessage =
        '📄 *Analisando seu documento PDF...*\n\n' +
        '🤖 Estou extraindo as informações financeiras.\n' +
        '_Isso pode levar alguns segundos._';

      this.emitReply(phoneNumber, processingMessage, platform, 'INTENT_RESPONSE', {
        processing: true,
        type: 'document',
      }, platformId);

      const result = await this.registrationService.processDocumentTransaction(
        phoneNumber,
        documentBuffer,
        mimeType,
        fileName,
        messageId,
        user,
        platform,
        activeAccountId,
      );

      if (result.message) {
        const context = result.requiresConfirmation ? 'CONFIRMATION_REQUEST' : 'TRANSACTION_RESULT';
        this.emitReply(phoneNumber, result.message, platform, context, {
          success: result.success,
          confirmationId: result.confirmationId,
        }, platformId);
      }

      return { ...result, platform };
    } catch (error) {
      this.logger.error(`❌ Erro ao processar documento:`, error);
      return {
        success: false,
        message: '❌ Erro ao processar documento PDF.',
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

      // Extrair intenção do texto para montar PaymentRequest apropriado
      const normalized = message.toLowerCase();
      let paymentRequest: import('./contexts/payment/payment.service').PaymentRequest;

      if (/fatura|cart[aã]o|cr[eé]dito/.test(normalized)) {
        paymentRequest = { paymentType: 'credit_card' };
      } else if (/conta\s+de\s+(luz|energia|água|agua|gás|gas|telefone|internet|aluguel)/.test(normalized)) {
        const catMatch = normalized.match(/conta\s+de\s+(\w+)/);
        paymentRequest = { paymentType: 'bill', category: catMatch?.[1] };
      } else {
        paymentRequest = { paymentType: 'pending_list' };
      }

      return await this.paymentService.processPayment(user, paymentRequest);
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
   * Tenta resolver uma mensagem UNKNOWN como follow-up contextual
   * baseado na última intenção da conversa.
   *
   * Exemplos:
   * - Última intent: LIST_TRANSACTIONS → "receitas" → LIST_TRANSACTIONS type=INCOME
   * - Última intent: MONTHLY_SUMMARY → "e fevereiro?" → MONTHLY_SUMMARY mês=02
   * - "outro" / "mais um" após REGISTER_TRANSACTION → nova transação (passthrough)
   */
  private async tryContextualFollowUp(
    phoneNumber: string,
    text: string,
    originalResult: IntentAnalysisResult,
  ): Promise<IntentAnalysisResult | null> {
    try {
      const lastIntent = await this.conversationMemory.getLastIntent(phoneNumber);
      if (!lastIntent) return null;

      const normalized = text.toLowerCase().trim();

      // Follow-ups para LIST_TRANSACTIONS
      if (lastIntent === 'LIST_TRANSACTIONS') {
        if (/^(receitas?|entradas?|ganhos?)$/.test(normalized)) {
          return {
            intent: MessageIntent.LIST_TRANSACTIONS,
            confidence: 0.8,
            shouldProcess: true,
            metadata: { type: 'INCOME' },
          };
        }
        if (/^(gastos?|despesas?|saidas?)$/.test(normalized)) {
          return {
            intent: MessageIntent.LIST_TRANSACTIONS,
            confidence: 0.8,
            shouldProcess: true,
            metadata: { type: 'EXPENSES' },
          };
        }
      }

      // Follow-ups para MONTHLY_SUMMARY / CATEGORY_BREAKDOWN
      if (lastIntent === 'MONTHLY_SUMMARY' || lastIntent === 'CATEGORY_BREAKDOWN') {
        const monthMatch = normalized.match(
          /(?:e\s+)?(?:de\s+)?(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)/,
        );
        if (monthMatch) {
          const monthNames: Record<string, number> = {
            janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
            julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12,
          };
          const month = monthNames[monthMatch[1]];
          const year = new Date().getFullYear();
          const monthRef = `${year}-${String(month).padStart(2, '0')}`;
          return {
            intent: lastIntent === 'MONTHLY_SUMMARY' ? MessageIntent.MONTHLY_SUMMARY : MessageIntent.CATEGORY_BREAKDOWN,
            confidence: 0.8,
            shouldProcess: true,
            metadata: { monthReference: monthRef },
          };
        }
        if (/(?:e\s+)?(?:o\s+)?mes passado/.test(normalized)) {
          const d = new Date();
          d.setMonth(d.getMonth() - 1);
          const monthRef = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          return {
            intent: lastIntent === 'MONTHLY_SUMMARY' ? MessageIntent.MONTHLY_SUMMARY : MessageIntent.CATEGORY_BREAKDOWN,
            confidence: 0.8,
            shouldProcess: true,
            metadata: { monthReference: monthRef },
          };
        }
      }

      // "outro" / "mais um" após REGISTER_TRANSACTION → passthrough (será processado como nova transação)
      if (lastIntent === 'REGISTER_TRANSACTION') {
        if (/^(outr[oa]|mais um[a]?|de novo)$/.test(normalized)) {
          return {
            intent: MessageIntent.REGISTER_TRANSACTION,
            confidence: 0.6,
            shouldProcess: true,
            suggestedResponse: '📝 Pode mandar! O que mais você gastou ou recebeu?',
          };
        }
      }

      return null;
    } catch (error) {
      this.logger.warn(`Erro ao resolver follow-up: ${error.message}`);
      return null;
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

        case 'transactions': {
          // Buscar item da lista de transações pelo número
          const item = context.items[itemNumber - 1];
          if (!item) {
            return {
              success: false,
              message: `❌ Item #${itemNumber} não encontrado. A lista tem ${context.items.length} item(s).`,
            };
          }

          if (action === 'pay' && item.metadata?.status === 'PENDING') {
            // Tentar pagar transação pendente diretamente
            return await this.paymentService.paySpecificTransaction(user, item.id);
          }

          // Ação padrão: mostrar detalhes da transação
          const t = item;
          const typeEmoji = t.metadata?.type === 'EXPENSES' ? '💸' : '💰';
          const statusEmoji =
            t.metadata?.status === 'DONE' ? '✅' : t.metadata?.status === 'OVERDUE' ? '🔴' : '⏳';

          let details =
            `${typeEmoji} *Transação #${itemNumber}*\n\n` +
            `📝 *Descrição:* ${t.description}\n` +
            `📂 *Categoria:* ${t.category || 'Sem categoria'}\n` +
            `💵 *Valor:* R$ ${(t.amount ?? 0).toFixed(2)}\n`;

          if (t.metadata?.date) {
            details += `📅 *Data:* ${new Date(t.metadata.date).toLocaleDateString('pt-BR')}\n`;
          }
          details += `${statusEmoji} *Status:* ${t.metadata?.status === 'DONE' ? 'Pago' : t.metadata?.status === 'OVERDUE' ? 'Atrasado' : 'Pendente'}\n`;
          details += `🔑 *ID:* \`${t.id}\``;

          if (t.metadata?.status === 'PENDING' || t.metadata?.status === 'OVERDUE') {
            details += `\n\n💡 _Para pagar, diga:_ *"pagar ${itemNumber}"*`;
          }

          return { success: true, message: details };
        }

        case 'confirmations':
          // Confirmações são tratadas pelo fluxo de sim/não — manter mensagem clara
          return {
            success: false,
            message: '⚠️ Para confirmar transações, responda *"sim"* ou *"não"*.',
          };

        case 'category_correction': {
          // Atualizar categoria da confirmação pendente com a seleção do usuário
          const catItem = context.items[itemNumber - 1];
          if (!catItem) {
            return {
              success: false,
              message: `❌ Item #${itemNumber} não encontrado na lista de categorias.`,
            };
          }
          const meta = catItem.metadata as {
            category: string;
            categoryId: string;
            subCategoryId: string | null;
            subCategoryName: string | null;
            confirmationId: string;
          };
          if (!meta?.confirmationId) {
            return {
              success: false,
              message: '❌ Confirmação não encontrada. Por favor, envie a transação novamente.',
            };
          }
          // Atualizar categoria no banco
          const updated = await this.confirmationService.updateCategory(
            meta.confirmationId,
            meta.category,
            meta.categoryId,
            meta.subCategoryId,
            meta.subCategoryName,
          );
          // Limpar contexto de seleção
          this.listContext.clearContext(user.phoneNumber);
          // Mostrar confirmação atualizada
          const confirmMsg = this.confirmationService.formatConfirmationMessage(updated);
          return { success: true, message: `✅ Categoria atualizada!\n\n${confirmMsg}` };
        }
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
