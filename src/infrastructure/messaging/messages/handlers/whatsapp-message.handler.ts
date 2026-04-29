import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { fireAndForget } from '@common/utils/with-retry';
import { TransactionConfirmationService } from '@features/transactions/transaction-confirmation.service';
import { MessageFilterService } from '../message-filter.service';
import { MessageContextService } from '../message-context.service';
import { PlatformReplyService } from '../platform-reply.service';
import { OnboardingService } from '@features/onboarding/onboarding.service';
import { UserCacheService } from '@features/users/user-cache.service';
import { UserRateLimiterService } from '@common/services/user-rate-limiter.service';
import { PrismaService } from '@core/database/prisma.service';
import { MessagingPlatform } from '@infrastructure/messaging/messaging-provider.interface';
import { IFilteredMessage, MessageType } from '@infrastructure/messaging/message.interface';
import {
  MessageValidationService,
  ValidationAction,
} from '@features/messages/message-validation.service';
import { TransactionsService } from '@features/transactions/transactions.service';
import { MESSAGE_EVENTS } from '@infrastructure/messaging/messaging-events.constants';
import { WhatsAppSessionManager } from '@infrastructure/whatsapp/providers/baileys/whatsapp-session-manager.service';

/**
 * WhatsAppMessageHandler
 *
 * Handler dedicado para processar mensagens do WhatsApp via Baileys.
 * Responsável por:
 * - Escutar evento 'session.message' (WhatsApp específico)
 * - Registrar contexto de WhatsApp no MessageContextService
 * - Filtrar mensagens válidas
 * - Enfileirar para processamento assíncrono
 * - Rotear para onboarding ou transações conforme usuário
 */
@Injectable()
export class WhatsAppMessageHandler {
  private readonly logger = new Logger(WhatsAppMessageHandler.name);

  constructor(
    private readonly messageFilter: MessageFilterService,
    private readonly contextService: MessageContextService,
    private readonly platformReply: PlatformReplyService,
    private readonly onboardingService: OnboardingService,
    private readonly transactionsService: TransactionsService,
    private readonly userCacheService: UserCacheService,
    private readonly userRateLimiter: UserRateLimiterService,
    private readonly prisma: PrismaService,
    private readonly messageValidation: MessageValidationService,
    private readonly confirmationService: TransactionConfirmationService,
    private readonly whatsappSessionManager: WhatsAppSessionManager,
  ) {}

  /**
   * Escuta evento whatsapp.message emitido pelo SessionManager (Baileys/WhatsApp)
   * Processa mensagem e roteia para fila de processamento
   */
  @OnEvent(MESSAGE_EVENTS.WHATSAPP)
  async handleIncomingMessage(payload: { sessionId: string; message: any }): Promise<void> {
    const { sessionId, message } = payload;

    try {
      // 📱 LOG INICIAL - Mostra SEMPRE de quem veio a mensagem ANTES de qualquer filtro
      const remoteJid = message.key.remoteJid;
      const senderPhone = remoteJid?.split('@')[0] || 'unknown';
      const messageId = message.key.id;

      // Ignorar mensagens de broadcast/status (status@broadcast) silenciosamente
      if (remoteJid === 'status@broadcast') {
        return;
      }

      this.logger.log(
        `📱 [WhatsApp] RAW MESSAGE | Session: ${sessionId} | From: ${senderPhone} | MessageId: ${messageId} | RemoteJid: ${remoteJid}`,
      );

      this.logger.debug(
        `📨 [WhatsApp] Received message from session ${sessionId}: ${message.key.id}`,
      );

      // Filtra e extrai dados da mensagem
      const filteredMessage = await this.messageFilter.extractMessageData(message);

      if (!filteredMessage) {
        this.logger.debug(
          `🚫 [WhatsApp] Message FILTERED OUT | From: ${senderPhone} | MessageId: ${messageId}`,
        );
        return;
      }

      // Ignorar mensagens enviadas por nós mesmos (evita loop infinito)
      if (filteredMessage.isFromMe) {
        this.logger.debug(`🚫 [WhatsApp] Ignoring self-sent message | MessageId: ${messageId}`);
        return;
      }

      const phoneNumber = filteredMessage.phoneNumber;
      this.logger.log(`✅ [WhatsApp] Processing message from ${phoneNumber}`);
      this.logger.log(`✅ [WhatsApp] message: ${JSON.stringify(filteredMessage)}`);

      // 🆕 [QW1] Resolver usuário via método unificado (single source of truth)
      const user = await this.userCacheService.resolveUserByPlatform(
        MessagingPlatform.WHATSAPP,
        phoneNumber,
      );
      const userId = user?.gastoCertoId;

      // 🆕 [QW2] Rate limit cross-platform por gastoCertoId quando disponível
      // Evita bypass por troca de canal; fallback para chave canal-específica
      const rateLimitKey = userId ?? `whatsapp:${phoneNumber}`;
      const rateLimitCheck = await this.userRateLimiter.checkLimit(rateLimitKey);

      if (!rateLimitCheck.allowed) {
        this.logger.warn(
          `🚫 [WhatsApp] Rate limit exceeded for ${rateLimitKey}: ${rateLimitCheck.reason} (retry after ${rateLimitCheck.retryAfter}s)`,
        );

        // Enviar mensagem de rate limit ao usuário
        const limitMessage = this.userRateLimiter.getRateLimitMessage(
          rateLimitCheck.reason!,
          rateLimitCheck.retryAfter!,
        );

        this.sendMessage(phoneNumber, limitMessage);
        return; // ❌ Bloqueia processamento
      }

      // ✅ Registrar uso da mensagem
      await this.userRateLimiter.recordUsage(rateLimitKey);

      // ✨ Registrar contexto de WhatsApp para roteamento de respostas
      await this.contextService.registerContext(
        phoneNumber,
        sessionId,
        MessagingPlatform.WHATSAPP,
        userId,
        phoneNumber,
      );
      this.logger.debug(
        `📝 Contexto registrado: WhatsApp [${phoneNumber}] → ${sessionId}` +
          (userId ? ` | userId: ${userId}` : ''),
      );

      // Processar mensagem de forma assíncrona (não bloqueia o event loop)
      fireAndForget(
        () => this.processMessage({ sessionId, message: filteredMessage, timestamp: Date.now() }),
        { label: `whatsapp:${filteredMessage.phoneNumber}` },
      );
    } catch (error) {
      this.logger.error(
        `[WhatsApp] Error handling message from session ${sessionId}: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Processa mensagem da fila (chamado pelo MessagesProcessor)
   * Verifica usuário e roteia para onboarding ou transações
   */
  async processMessage(data: {
    sessionId: string;
    message: IFilteredMessage;
    timestamp: number;
  }): Promise<void> {
    const { sessionId, message } = data;
    const phoneNumber = message.phoneNumber;

    try {
      this.logger.log(
        `🔄 [WhatsApp] Processing queued message from ${phoneNumber} (${message.type})`,
      );

      // ✨ NOVO: Usar MessageValidationService para validação unificada
      const validation = await this.messageValidation.validateUser(phoneNumber, 'whatsapp');

      // 🔄 [M1] SINCRONIZAÇÃO: usar predicado unificado (cache antigo OU flags inativas)
      const syncDecision = validation.user
        ? this.userCacheService.shouldRefreshSubscription(validation.user)
        : { refresh: false };

      if (syncDecision.refresh && validation.user) {
        this.logger.log(`⏰ [WhatsApp] Sincronizando assinatura para ${phoneNumber} (motivo: ${syncDecision.reason})`);
        await this.userCacheService.syncSubscriptionStatus(validation.user.gastoCertoId);

        // Revalidar usuário com dados atualizados
        const updatedValidation = await this.messageValidation.validateUser(
          phoneNumber,
          'whatsapp',
        );

        // Se ainda não pode usar, bloquear — verifica action E flags diretamente
        // (cobre casos onde a chave de cache não foi totalmente atualizada pelo sync)
        const blockedAfterSync =
          updatedValidation.action === ValidationAction.NO_SUBSCRIPTION ||
          !updatedValidation.user?.canUseGastoZap ||
          !updatedValidation.user?.hasActiveSubscription;

        if (blockedAfterSync) {
          this.logger.warn(`[WhatsApp] 💳 Acesso negado após sync: ${phoneNumber} (hasActiveSubscription=${updatedValidation.user?.hasActiveSubscription}, canUseGastoZap=${updatedValidation.user?.canUseGastoZap})`);
          this.sendMessage(
            phoneNumber,
            updatedValidation.user?.hasActiveSubscription
              ? '💳 Seu plano atual não inclui o GastoZap. Faça upgrade para usar esse recurso.'
              : '💳 Sua assinatura não está ativa. Renove para continuar usando o serviço.',
          );
          return;
        }
      }

      // Tratar ações conforme resultado da validação
      switch (validation.action) {
        case ValidationAction.ONBOARDING:
          // Usuário está em onboarding - processar mensagem
          this.logger.log(`[WhatsApp] 📝 User ${phoneNumber} is in onboarding`);
          await this.handleOnboardingMessage(message);
          return;

        case ValidationAction.START_ONBOARDING:
          // Novo usuário - iniciar onboarding
          this.logger.log(`[WhatsApp] ⭐ Starting onboarding for new user ${phoneNumber}`);
          const welcomeMessage = await this.messageValidation.startOnboarding(
            phoneNumber,
            'whatsapp',
          );
          if (welcomeMessage) {
            this.sendMessage(phoneNumber, welcomeMessage);
          }
          return;

        case ValidationAction.BLOCKED:
          // Usuário bloqueado
          this.logger.warn(`[WhatsApp] ❌ User ${phoneNumber} is BLOCKED`);
          this.sendMessage(phoneNumber, validation.message!);
          return;

        case ValidationAction.INACTIVE:
          // Usuário inativo - reativar
          this.logger.log(`[WhatsApp] 🔄 Reactivating user ${phoneNumber}`);
          await this.onboardingService.reactivateUser(phoneNumber, 'whatsapp');
          return;

        case ValidationAction.NO_SUBSCRIPTION:
          // Sem assinatura ativa
          this.logger.warn(`[WhatsApp] 💳 User ${phoneNumber} has no subscription`);
          this.sendMessage(phoneNumber, validation.message!);
          return;

        case ValidationAction.LEARNING_PENDING:
          // Aprendizado pendente
          this.logger.log(`[WhatsApp] 🎓 Processing learning for ${phoneNumber}`);
          const learningResult = await this.messageValidation.processLearning(
            phoneNumber,
            message.text,
            message.messageId,
            validation.user!,
            'whatsapp',
          );

          if (learningResult.success) {
            this.sendMessage(phoneNumber, learningResult.message);
          }
          return;

        case ValidationAction.PROCEED:
          // Usuário válido - prosseguir com processamento normal
          this.logger.log(`[WhatsApp] ✅ Processing message for user ${validation.user!.name}`);
          break;

        default:
          this.logger.warn(`[WhatsApp] Unknown validation action: ${validation.action}`);
          return;
      }

      // Continuar com fluxo normal de transações
      const user = validation.user!;

      // Verificar se é confirmação de transação pendente
      const pendingConfirmation = await this.checkPendingConfirmation(phoneNumber, message.text);

      if (pendingConfirmation) {
        this.logger.log(`[WhatsApp] Processing transaction confirmation for ${phoneNumber}`);

        // Processar confirmação diretamente
        const confirmResult = await this.confirmationService.processResponse(phoneNumber, message.text);

        // Enviar emoji reaction na mensagem do usuário (best-effort)
        if (confirmResult.action === 'confirmed') {
          fireAndForget(
            () => this.whatsappSessionManager.sendReaction(sessionId, phoneNumber, message.messageId, '✅'),
            { label: `reaction:${phoneNumber}` },
          );
        } else if (confirmResult.action === 'rejected') {
          fireAndForget(
            () => this.whatsappSessionManager.sendReaction(sessionId, phoneNumber, message.messageId, '❌'),
            { label: `reaction:${phoneNumber}` },
          );
        }

        return;
      }

      // Não é confirmação - processar como nova transação
      this.logger.log(`[WhatsApp] Processing new transaction for user ${user.name}`);

      const accountId = user.activeAccountId; // Usar accountId do cache do usuário

      // 🆕 NOVO: Processar por tipo de mensagem (igual Telegram)
      switch (message.type) {
        case MessageType.TEXT:
          // Texto: processar transação diretamente
          this.logger.log(`[WhatsApp] Processing text message`);
          await this.transactionsService.processTextMessage(
            user,
            message.text || '',
            message.messageId,
            'whatsapp',
            phoneNumber,
            accountId,
          );
          break;

        case MessageType.IMAGE:
          // Imagem: processar diretamente via IA
          if (message.imageBuffer) {
            this.logger.log(`[WhatsApp] Processing image message directly`);
            await this.transactionsService.processImageMessage(
              user, // Passar objeto user completo
              message.imageBuffer,
              message.mimeType || 'image/jpeg',
              message.messageId,
              'whatsapp',
              phoneNumber, // platformId
              accountId, // Passar accountId do cache
            );
          } else {
            this.logger.warn(`[WhatsApp] Image message without buffer`);
          }
          break;

        case MessageType.AUDIO:
          // Áudio: processar diretamente via IA
          if (message.audioBuffer) {
            this.logger.log(`[WhatsApp] Processing audio message directly`);
            await this.transactionsService.processAudioMessage(
              user, // Passar objeto user completo
              message.audioBuffer,
              message.mimeType || 'audio/ogg',
              message.messageId,
              'whatsapp',
              phoneNumber, // platformId
              accountId, // Passar accountId do cache
            );
          } else {
            this.logger.warn(`[WhatsApp] Audio message without buffer`);
          }
          break;

        case MessageType.DOCUMENT:
          // Documento PDF: processar via IA
          if (message.documentBuffer) {
            this.logger.log(`[WhatsApp] Processing document message: ${message.fileName}`);
            await this.transactionsService.processDocumentMessage(
              user,
              message.documentBuffer,
              message.mimeType || 'application/pdf',
              message.fileName || 'documento.pdf',
              message.messageId,
              'whatsapp',
              phoneNumber,
              accountId,
            );
          } else {
            this.logger.warn(`[WhatsApp] Document message without buffer`);
            this.sendMessage(
              phoneNumber,
              '❌ Não consegui baixar o documento.\n\n_Tente reenviar o arquivo._',
            );
          }
          break;

        case MessageType.VIDEO:
          this.logger.warn(`[WhatsApp] Video messages are not supported from ${phoneNumber}`);
          this.sendMessage(
            phoneNumber,
            '⚠️ Vídeos não são suportados.\n\n' +
              'Envie:\n' +
              '• Texto: "Gastei 50 reais em alimentação"\n' +
              '• Foto de nota fiscal ou comprovante\n' +
              '• PDF de extrato ou nota fiscal\n' +
              '• Áudio descrevendo o gasto',
          );
          break;

        default:
          this.logger.warn(`[WhatsApp] Unsupported message type: ${message.type}`);
          this.sendMessage(
            phoneNumber,
            '❌ Tipo de mensagem não suportado.\n\n' +
              'Envie:\n' +
              '• Texto: "Gastei 50 reais em alimentação"\n' +
              '• Foto de nota fiscal ou comprovante\n' +
              '• PDF de extrato ou nota fiscal\n' +
              '• Áudio descrevendo o gasto',
          );
      }

      this.logger.log(`[WhatsApp] Message processed successfully`);
    } catch (error) {
      this.logger.error(
        `[WhatsApp] Error processing message from ${phoneNumber}: ${error.message}`,
        error.stack,
      );

      // 🆕 Notificar usuário sobre o erro (antes ficava silencioso)
      try {
        this.sendMessage(
          phoneNumber,
          '❌ Desculpe, ocorreu um erro ao processar sua mensagem.\n\n' +
            'Por favor, tente novamente em alguns instantes.',
        );
      } catch (replyError) {
        this.logger.error(`[WhatsApp] Failed to send error reply: ${replyError.message}`);
      }
    }
  }

  /**
   * Processa mensagem durante onboarding
   * USA EVENTOS GENÉRICOS (padrão unificado WhatsApp/Telegram)
   */
  private async handleOnboardingMessage(message: IFilteredMessage): Promise<void> {
    this.logger.log(`📝 [WhatsApp] Processing onboarding message`);

    if (message.type !== 'text' || !message.text) {
      // Onboarding aceita apenas texto
      return;
    }

    try {
      // Usar handleMessage() que emite eventos automaticamente
      await this.onboardingService.handleMessage(message);
    } catch (error) {
      this.logger.error(
        `[WhatsApp] Error processing onboarding for ${message.phoneNumber}:`,
        error,
      );
    }
  }

  /**
   * Envia mensagem ao usuário via WhatsApp
   */
  private sendMessage(phoneNumber: string, message: string): void {
    this.logger.debug(`📤 Enviando mensagem para ${phoneNumber}`);

    this.platformReply.sendReply({
      platformId: phoneNumber,
      message,
      context: 'ERROR',
      platform: MessagingPlatform.WHATSAPP,
    });
  }

  /**
   * Verifica se usuário tem confirmação de transação pendente
   */
  private async checkPendingConfirmation(
    phoneNumber: string,
    text: string,
  ): Promise<{ id: string } | null> {
    try {
      // Buscar confirmação pendente nos últimos 5 minutos
      const confirmation = await this.prisma.transactionConfirmation.findFirst({
        where: {
          phoneNumber,
          status: 'PENDING',
          deletedAt: null,
          createdAt: {
            gte: new Date(Date.now() - 5 * 60 * 1000), // 5 minutos
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      if (!confirmation) return null;

      // Verificar se mensagem é resposta de confirmação (sim/não)
      const normalized = text.toLowerCase().trim();
      const confirmationWords = [
        'sim',
        's',
        'confirmar',
        'ok',
        'confirmo',
        'yes',
        'não',
        'n',
        'nao',
        'cancelar',
        'cancel',
        'no',
      ];

      const isConfirmationResponse = confirmationWords.some((word) => normalized === word);

      return isConfirmationResponse ? { id: confirmation.id } : null;
    } catch (error) {
      this.logger.error(`Error checking pending confirmation: ${error.message}`);
      return null;
    }
  }
}
