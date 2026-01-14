import { Injectable, Logger } from '@nestjs/common';
import TelegramBot from 'node-telegram-bot-api';
import {
  IMessagingProvider,
  MessagingPlatform,
  MessagingConnectionConfig,
  MessagingCallbacks,
  IncomingMessage,
  MessageType,
  SendMessageOptions,
  SendMediaOptions,
  MessageResult,
  UserInfo,
} from '@infrastructure/messaging/messaging-provider.interface';
import { UserRateLimiterService } from '@common/services/user-rate-limiter.service';

@Injectable()
export class TelegramProvider implements IMessagingProvider {
  private readonly logger = new Logger(TelegramProvider.name);
  public readonly platform = MessagingPlatform.TELEGRAM;

  private bot: TelegramBot | null = null;
  private callbacks: MessagingCallbacks = {};
  private connected = false;
  private conflict409Count = 0;
  private readonly MAX_409_ERRORS = 3; // Após 3 erros 409, tentar reconexão
  private readonly MAX_RECONNECT_ATTEMPTS = 2; // Máximo de tentativas de reconexão por erro
  private readonly MAX_TOTAL_RECONNECTS = 3; // Máximo de reconexões no total em 5 minutos
  private reconnectAttempts = 0;
  private totalReconnects = 0;
  private lastReconnectTime = 0;
  private isReconnecting = false;
  private sessionId?: string;
  private sessionName?: string;
  private lastConfig?: MessagingConnectionConfig;

  constructor(private readonly userRateLimiter: UserRateLimiterService) {}

  async initialize(
    config: MessagingConnectionConfig,
    callbacks: MessagingCallbacks,
  ): Promise<void> {
    try {
      this.callbacks = callbacks;
      this.lastConfig = config; // Salvar para reconexão
      this.sessionId = config.sessionId;
      this.sessionName = config.sessionName || 'Unknown'; // Nome do banco de dados
      const token = config.credentials?.token;

      if (!token) {
        throw new Error('Telegram bot token is required');
      }

      this.logger.log(
        `🚀 Initializing Telegram bot for session "${this.sessionName}" (${this.sessionId})...`,
      );

      // Criar bot com configurações de rede otimizadas
      this.bot = new TelegramBot(token, {
        polling: {
          interval: 300,
          autoStart: true,
        },
      });

      // Setup event handlers
      this.setupEventHandlers();

      // Verificar bot info
      const me = await this.bot.getMe();
      const botUsername = `@${me.username}`;
      this.logger.log(
        `✅ Connected to Telegram as ${botUsername} for session "${this.sessionName}" (${this.sessionId})`,
      );

      this.connected = true;
      this.callbacks.onConnected?.();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to initialize Telegram bot: ${errorMessage}`);
      this.callbacks.onError?.(error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.bot) {
      const sessionInfo = this.sessionName
        ? `"${this.sessionName}" (${this.sessionId})`
        : this.sessionId || 'unknown';
      this.logger.log(`🔌 Disconnecting Telegram bot ${sessionInfo}...`);

      try {
        // Parar polling (isso para de buscar novas mensagens)
        await this.bot.stopPolling();

        // Remover todos os listeners para evitar memory leaks
        this.bot.removeAllListeners();

        this.logger.log(`✅ Telegram bot ${sessionInfo} disconnected successfully`);
      } catch (error) {
        this.logger.error(`⚠️  Error stopping Telegram polling for ${sessionInfo}:`, error);
      }

      this.bot = null;
      this.connected = false;
      this.callbacks.onDisconnected?.();
    }
  }

  async sendTextMessage(
    chatId: string,
    text: string,
    options?: SendMessageOptions,
  ): Promise<MessageResult> {
    const maxRetries = 3;
    const baseDelay = 1000; // 1 segundo

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (!this.bot) {
          throw new Error('Bot not initialized');
        }

        this.logger.debug(
          `📤 Tentativa ${attempt}/${maxRetries} - Enviando mensagem para ${chatId}`,
        );

        const result = await this.bot.sendMessage(chatId, text, {
          parse_mode: 'Markdown',
          disable_web_page_preview: !options?.linkPreview,
          reply_to_message_id: options?.quotedMessageId
            ? parseInt(options.quotedMessageId)
            : undefined,
        });

        this.logger.log(`✅ Mensagem enviada com sucesso para ${chatId} (tentativa ${attempt})`);

        return {
          success: true,
          messageId: result.message_id.toString(),
        };
      } catch (error: any) {
        const isLastAttempt = attempt === maxRetries;
        const isTimeoutError = error.code === 'ETIMEDOUT' || error.code === 'EFATAL';

        this.logger.warn(
          `⚠️ Erro ao enviar mensagem (tentativa ${attempt}/${maxRetries}): ${error.message || error.code}`,
        );

        // Se não é timeout ou é última tentativa, falha imediatamente
        if (!isTimeoutError || isLastAttempt) {
          const errorMessage = error.message || error.code || 'Unknown error';
          this.logger.error(`Error sending text message: ${errorMessage}`);
          return {
            success: false,
            error: errorMessage,
          };
        }

        // Aguardar antes de tentar novamente (exponential backoff)
        const delay = baseDelay * Math.pow(2, attempt - 1);
        this.logger.log(`⏳ Aguardando ${delay}ms antes de tentar novamente...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    // Nunca deve chegar aqui, mas por segurança
    return {
      success: false,
      error: 'Max retries exceeded',
    };
  }

  async sendImageMessage(
    chatId: string,
    image: Buffer,
    options?: SendMediaOptions,
  ): Promise<MessageResult> {
    try {
      if (!this.bot) {
        throw new Error('Bot not initialized');
      }

      const result = await this.bot.sendPhoto(chatId, image, {
        caption: options?.caption,
        parse_mode: 'Markdown',
        reply_to_message_id: options?.quotedMessageId
          ? parseInt(options.quotedMessageId)
          : undefined,
      });

      return {
        success: true,
        messageId: result.message_id.toString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error sending image: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  async sendAudioMessage(
    chatId: string,
    audio: Buffer,
    options?: SendMediaOptions,
  ): Promise<MessageResult> {
    try {
      if (!this.bot) {
        throw new Error('Bot not initialized');
      }

      const result = await this.bot.sendVoice(chatId, audio, {
        caption: options?.caption,
        reply_to_message_id: options?.quotedMessageId
          ? parseInt(options.quotedMessageId)
          : undefined,
      });

      return {
        success: true,
        messageId: result.message_id.toString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error sending audio: ${errorMessage}`);
      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  async downloadMedia(message: any): Promise<Buffer | null> {
    try {
      if (!this.bot) {
        throw new Error('Bot not initialized');
      }

      let fileId: string | undefined;

      // Detectar tipo de mídia e pegar file_id
      if (message.photo) {
        // Pegar a maior resolução
        const photos = message.photo;
        fileId = photos[photos.length - 1].file_id;
      } else if (message.voice) {
        fileId = message.voice.file_id;
      } else if (message.audio) {
        fileId = message.audio.file_id;
      } else if (message.document) {
        fileId = message.document.file_id;
      } else if (message.video) {
        fileId = message.video.file_id;
      }

      if (!fileId) {
        return null;
      }

      // Download do arquivo
      const fileLink = await this.bot.getFileLink(fileId);
      const response = await fetch(fileLink);
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error downloading media: ${errorMessage}`);
      return null;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async getUserInfo(userId: string): Promise<UserInfo | null> {
    try {
      if (!this.bot) {
        return null;
      }

      const chat = await this.bot.getChat(userId);

      return {
        id: userId,
        username: chat.username,
        firstName: chat.first_name,
        lastName: chat.last_name,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error getting user info: ${errorMessage}`);
      return null;
    }
  }

  private setupEventHandlers(): void {
    if (!this.bot) return;

    this.logger.log('🎧 [TelegramProvider] Setting up event handlers');

    // Mensagens de texto
    this.bot.on('text', (msg) => {
      this.logger.log('📝 [TelegramProvider] Text message received');
      this.handleIncomingMessage(msg, MessageType.TEXT);
    });

    // Mensagens de foto
    this.bot.on('photo', (msg) => {
      this.logger.log('📸 [TelegramProvider] Photo message received');
      this.handleIncomingMessage(msg, MessageType.IMAGE);
    });

    // Mensagens de voz
    this.bot.on('voice', (msg) => {
      this.handleIncomingMessage(msg, MessageType.AUDIO);
    });

    // Mensagens de áudio (música)
    this.bot.on('audio', (msg) => {
      this.handleIncomingMessage(msg, MessageType.AUDIO);
    });

    // Mensagens de documento
    this.bot.on('document', (msg) => {
      this.handleIncomingMessage(msg, MessageType.DOCUMENT);
    });

    // Mensagens de contato (phone sharing)
    this.bot.on('contact', (msg) => {
      this.logger.log('📞 [TelegramProvider] Contact message received');
      this.handleIncomingMessage(msg, MessageType.TEXT);
    });

    // Polling errors
    this.bot.on('polling_error', (error) => {
      // Log apenas a mensagem, sem stack trace
      const errorMessage = error instanceof Error ? error.message : String(error);
      const sessionInfo = `${this.sessionName || 'Unknown'} (${this.sessionId || 'Unknown'})`;

      // Detectar erro 400 Logged out (após logout forçado)
      if (
        errorMessage.includes('400 Logged out') ||
        errorMessage.includes('ETELEGRAM: 400 Logged out')
      ) {
        // Silenciar esse erro - é esperado após logout forçado
        // O processo de reconexão já está em andamento
        return;
      }

      // Detectar erro 401 (Token inválido/expirado)
      if (errorMessage.includes('401 Unauthorized') || errorMessage.includes('ETELEGRAM: 401')) {
        this.logger.error(
          `🚨 ERRO 401 CRÍTICO na sessão ${sessionInfo}. Tentando reconexão automática...`,
        );

        // Tentar reconexão automática
        this.attemptReconnect('401 Unauthorized').catch(() => {});
        return;
      }

      // Detectar erro 409 (conflito de múltiplas instâncias)
      if (errorMessage.includes('409 Conflict')) {
        this.conflict409Count++;

        if (this.conflict409Count >= this.MAX_409_ERRORS) {
          this.logger.error(
            `� ERRO 409 RECORRENTE (${this.conflict409Count}x) na sessão ${sessionInfo}. ` +
              `Tentando reconexão automática...`,
          );

          // Tentar reconexão automática
          this.attemptReconnect('409 Conflict').catch(() => {});
          return;
        }

        this.logger.warn(
          `⚠️  Erro 409 detectado (${this.conflict409Count}/${this.MAX_409_ERRORS}) na sessão ${sessionInfo}: ${errorMessage}`,
        );
      } else {
        // Resetar contador se não for erro 409
        this.conflict409Count = 0;
        this.logger.error(`Telegram polling error (${sessionInfo}): ${errorMessage}`);
      }

      this.callbacks.onError?.(error);
    });
  }

  /**
   * Força logout no Telegram para desconectar todas as instâncias ativas
   * Útil quando há erro 409 (conflito de múltiplas instâncias)
   */
  private async forceLogoutFromTelegram(): Promise<boolean> {
    const sessionInfo = `${this.sessionName} (${this.sessionId})`;

    if (!this.bot || !this.lastConfig?.credentials?.token) {
      this.logger.warn(`⚠️  Bot ou token não disponível para forçar logout de ${sessionInfo}`);
      return false;
    }

    try {
      this.logger.log(
        `🔌 Forçando logout de todas as instâncias no Telegram para ${sessionInfo}...`,
      );

      // Usar logOut para forçar desconexão de todas as instâncias
      // Isso faz uma chamada direta à API do Telegram
      const token = this.lastConfig.credentials.token;
      const response = await fetch(`https://api.telegram.org/bot${token}/logOut`, {
        method: 'POST',
      });

      const data = await response.json();

      if (data.ok) {
        this.logger.log(`✅ Logout forçado com sucesso para ${sessionInfo}`);
        return true;
      } else if (data.error_code === 400 && data.description?.includes('Logged out')) {
        this.logger.log(`ℹ️  Bot já estava deslogado para ${sessionInfo}`);
        return false; // Já estava deslogado, não precisa esperar tanto
      } else {
        this.logger.warn(`⚠️  Logout retornou: ${JSON.stringify(data)}`);
        return false;
      }
    } catch (error: any) {
      this.logger.warn(`⚠️  Erro ao forçar logout (ignorando): ${error.message}`);
      return false;
      // Não lançar erro - continuar com o processo de reconexão
    }
  }

  /**
   * Tenta reconectar automaticamente após erro crítico
   */
  private async attemptReconnect(errorType: string): Promise<void> {
    if (this.isReconnecting) {
      this.logger.warn(`Reconexão já em andamento para sessão ${this.sessionId}`);
      return;
    }

    // Verificar se já ultrapassou o limite total de reconexões em 5 minutos
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;

    if (now - this.lastReconnectTime > fiveMinutes) {
      // Reset contador se passou mais de 5 minutos
      this.totalReconnects = 0;
    }

    this.totalReconnects++;
    this.lastReconnectTime = now;

    if (this.totalReconnects > this.MAX_TOTAL_RECONNECTS) {
      this.logger.error(
        `❌ Máximo de ${this.MAX_TOTAL_RECONNECTS} reconexões em 5 minutos atingido para ${this.sessionName} (${this.sessionId}). ` +
          `Possível loop infinito detectado. Desativando sessão. Erro: ${errorType}`,
      );

      await this.disconnect();
      this.callbacks.onError?.(new Error(`Reconnection loop detected: ${errorType}`));
      return;
    }

    this.reconnectAttempts++;
    const sessionInfo = `${this.sessionName} (${this.sessionId})`;

    if (this.reconnectAttempts > this.MAX_RECONNECT_ATTEMPTS) {
      this.logger.error(
        `❌ Máximo de ${this.MAX_RECONNECT_ATTEMPTS} tentativas de reconexão atingido para ${sessionInfo}. ` +
          `Desativando sessão. Erro: ${errorType}`,
      );

      await this.disconnect();
      this.callbacks.onError?.(new Error(`Max reconnection attempts reached: ${errorType}`));
      return;
    }

    this.isReconnecting = true;
    this.logger.log(
      `🔄 Tentativa ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS} de reconexão para ${sessionInfo} (Total: ${this.totalReconnects})...`,
    );

    try {
      // Se for erro 409, forçar logout no Telegram para desconectar outras instâncias
      let needsLongerWait = false;
      if (errorType.includes('409 Conflict')) {
        const loggedOut = await this.forceLogoutFromTelegram();
        needsLongerWait = loggedOut; // Se fez logout, precisa esperar mais
      }

      // Desconectar completamente
      await this.disconnect();

      // Aguardar antes de reconectar (aumentar progressivamente)
      // Se fez logout com sucesso, aguardar mais tempo para o Telegram processar
      let baseWaitTime = Math.min(this.reconnectAttempts * 3000, 10000); // 3s, 6s, max 10s
      if (needsLongerWait) {
        baseWaitTime += 5000; // +5s extra se fez logout (para o Telegram processar)
      }

      this.logger.log(`⏳ Aguardando ${baseWaitTime}ms antes de reconectar...`);
      await new Promise((resolve) => setTimeout(resolve, baseWaitTime));

      // Tentar reconectar
      if (this.lastConfig && this.callbacks) {
        await this.initialize(this.lastConfig, this.callbacks);
        this.logger.log(`✅ Reconexão bem-sucedida para ${sessionInfo}`);
        this.reconnectAttempts = 0; // Reset contador em sucesso
        this.conflict409Count = 0; // Reset contador 409
      } else {
        throw new Error('Config ou callbacks não disponíveis para reconexão');
      }
    } catch (error: any) {
      this.logger.error(
        `❌ Falha na tentativa ${this.reconnectAttempts} de reconexão: ${error.message}`,
      );

      // Se falhar, tentar novamente (se não atingiu o máximo)
      if (this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS) {
        this.logger.log(`🔄 Agendando nova tentativa de reconexão...`);
        setTimeout(() => {
          this.isReconnecting = false;
          this.attemptReconnect(errorType).catch(() => {});
        }, 5000); // Aguardar 5s antes de tentar novamente
      } else {
        this.callbacks.onError?.(error);
      }
    } finally {
      this.isReconnecting = false;
    }
  }

  private async handleIncomingMessage(msg: TelegramBot.Message, type: MessageType): Promise<void> {
    try {
      const chatId = msg.chat.id.toString();

      // 🆕 VERIFICAR RATE LIMITING (proteção contra spam)
      // Usar chatId como identificador para Telegram
      const rateLimitCheck = await this.userRateLimiter.checkLimit(chatId);

      if (!rateLimitCheck.allowed) {
        this.logger.warn(
          `🚫 [Telegram] Rate limit exceeded for chat ${chatId}: ${rateLimitCheck.reason} (retry after ${rateLimitCheck.retryAfter}s)`,
        );

        // Enviar mensagem de rate limit ao usuário
        const limitMessage = this.userRateLimiter.getRateLimitMessage(
          rateLimitCheck.reason!,
          rateLimitCheck.retryAfter!,
        );

        await this.sendTextMessage(chatId, limitMessage);
        return; // ❌ Bloqueia processamento
      }

      // ✅ Registrar uso da mensagem
      await this.userRateLimiter.recordUsage(chatId);

      const incomingMessage: IncomingMessage = {
        id: msg.message_id.toString(),
        chatId,
        userId: msg.from?.id.toString() || chatId,
        platform: MessagingPlatform.TELEGRAM,
        timestamp: new Date(msg.date * 1000),
        type,
        text: msg.text || msg.caption,
        metadata: {
          username: msg.from?.username,
          firstName: msg.from?.first_name,
          lastName: msg.from?.last_name,
          phoneNumber: (msg as any).contact?.phone_number, // Telefone do contact sharing
          contactUserId: (msg as any).contact?.user_id?.toString(), // ID do usuário do contato
        },
      };

      // Download de mídia se necessário
      if (type !== MessageType.TEXT && (msg.photo || msg.voice || msg.audio || msg.document)) {
        const mediaBuffer = await this.downloadMedia(msg);
        if (mediaBuffer) {
          incomingMessage.mediaBuffer = mediaBuffer;

          // Detectar mime type
          if (msg.photo) {
            incomingMessage.mimeType = 'image/jpeg';
          } else if (msg.voice) {
            incomingMessage.mimeType = 'audio/ogg';
          } else if (msg.audio) {
            incomingMessage.mimeType = msg.audio.mime_type;
          } else if (msg.document) {
            incomingMessage.mimeType = msg.document.mime_type;
          }
        }
      }

      this.logger.log(
        `📩 [TelegramProvider] Received ${type} message from ${incomingMessage.metadata.firstName || 'Unknown'} (${incomingMessage.userId})`,
      );

      if (this.callbacks.onMessage) {
        this.logger.log('📤 [TelegramProvider] Calling onMessage callback');
        this.callbacks.onMessage(incomingMessage);
      } else {
        this.logger.warn('⚠️  [TelegramProvider] No onMessage callback registered!');
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error handling incoming message: ${errorMessage}`);
      this.callbacks.onError?.(error);
    }
  }
}
