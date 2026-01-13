/**
 * Interface genérica para provedores de mensageria
 * Suporta WhatsApp, Telegram, Discord, etc.
 */

export enum MessagingPlatform {
  WHATSAPP = 'whatsapp',
  TELEGRAM = 'telegram',
  DISCORD = 'discord',
}

export interface IMessagingProvider {
  /**
   * Plataforma do provider
   */
  readonly platform: MessagingPlatform;

  /**
   * Inicializa conexão
   */
  initialize(config: MessagingConnectionConfig, callbacks: MessagingCallbacks): Promise<void>;

  /**
   * Desconecta
   */
  disconnect(): Promise<void>;

  /**
   * Envia mensagem de texto
   */
  sendTextMessage(
    chatId: string,
    text: string,
    options?: SendMessageOptions,
  ): Promise<MessageResult>;

  /**
   * Envia mensagem com imagem
   */
  sendImageMessage(
    chatId: string,
    image: Buffer,
    options?: SendMediaOptions,
  ): Promise<MessageResult>;

  /**
   * Envia mensagem de áudio
   */
  sendAudioMessage(
    chatId: string,
    audio: Buffer,
    options?: SendMediaOptions,
  ): Promise<MessageResult>;

  /**
   * Baixa mídia de mensagem
   */
  downloadMedia(message: any): Promise<Buffer | null>;

  /**
   * Verifica se está conectado
   */
  isConnected(): boolean;

  /**
   * Obtém informações do usuário
   */
  getUserInfo(userId: string): Promise<UserInfo | null>;
}

export interface MessagingConnectionConfig {
  platform: MessagingPlatform;
  credentials: any; // Token do bot, API key, etc
  sessionId?: string;
  [key: string]: any;
}

export interface MessagingCallbacks {
  onConnected?: () => void;
  onDisconnected?: (reason?: string) => void;
  onQRCode?: (qr: string) => void;
  onMessage?: (message: IncomingMessage) => void;
  onError?: (error: Error) => void;
}

export interface IncomingMessage {
  id: string;
  chatId: string;
  userId: string;
  platform: MessagingPlatform;
  timestamp: Date;
  type: MessageType;
  text?: string;
  mediaBuffer?: Buffer;
  mimeType?: string;
  metadata?: any;
}

export enum MessageType {
  TEXT = 'text',
  IMAGE = 'image',
  AUDIO = 'audio',
  VIDEO = 'video',
  DOCUMENT = 'document',
  STICKER = 'sticker',
}

export interface SendMessageOptions {
  quotedMessageId?: string;
  mentions?: string[];
  linkPreview?: boolean;
  [key: string]: any;
}

export interface SendMediaOptions extends SendMessageOptions {
  caption?: string;
  filename?: string;
}

export interface MessageResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface UserInfo {
  id: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  phoneNumber?: string;
  profilePicture?: string;
}
