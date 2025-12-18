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
} from '@common/interfaces/messaging-provider.interface';

@Injectable()
export class TelegramProvider implements IMessagingProvider {
  private readonly logger = new Logger(TelegramProvider.name);
  public readonly platform = MessagingPlatform.TELEGRAM;

  private bot: TelegramBot | null = null;
  private callbacks: MessagingCallbacks = {};
  private connected = false;

  async initialize(
    config: MessagingConnectionConfig,
    callbacks: MessagingCallbacks,
  ): Promise<void> {
    try {
      this.callbacks = callbacks;
      const token = config.credentials?.token;

      if (!token) {
        throw new Error('Telegram bot token is required');
      }

      this.logger.log(`🚀 Initializing Telegram bot...`);

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
      this.logger.log(`✅ Connected to Telegram as @${me.username}`);

      this.connected = true;
      this.callbacks.onConnected?.();
    } catch (error) {
      this.logger.error(`Failed to initialize Telegram bot:`, error);
      this.callbacks.onError?.(error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.bot) {
      this.logger.log('Disconnecting from Telegram...');
      await this.bot.stopPolling();
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
          this.logger.error('Error sending text message:', error);
          return {
            success: false,
            error: error.message || error.code || 'Unknown error',
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
      this.logger.error('Error sending image:', error);
      return {
        success: false,
        error: error.message,
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
      this.logger.error('Error sending audio:', error);
      return {
        success: false,
        error: error.message,
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
      this.logger.error('Error downloading media:', error);
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
      this.logger.error('Error getting user info:', error);
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
      this.logger.error('Telegram polling error:', error);
      this.callbacks.onError?.(error);
    });
  }

  private async handleIncomingMessage(msg: TelegramBot.Message, type: MessageType): Promise<void> {
    try {
      const incomingMessage: IncomingMessage = {
        id: msg.message_id.toString(),
        chatId: msg.chat.id.toString(),
        userId: msg.from?.id.toString() || msg.chat.id.toString(),
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
      this.logger.error('Error handling incoming message:', error);
      this.callbacks.onError?.(error);
    }
  }
}
