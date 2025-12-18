/**
 * Interface genérica para provedores de WhatsApp
 * Permite trocar facilmente entre Baileys e API Oficial do WhatsApp
 */

export interface IWhatsAppProvider {
  /**
   * Inicializa conexão com WhatsApp
   */
  initialize(config: WhatsAppConnectionConfig, callbacks: WhatsAppCallbacks): Promise<void>;

  /**
   * Desconecta do WhatsApp
   */
  disconnect(): Promise<void>;

  /**
   * Envia mensagem de texto
   */
  sendTextMessage(jid: string, text: string, options?: SendMessageOptions): Promise<MessageResult>;

  /**
   * Envia mensagem com imagem
   */
  sendImageMessage(jid: string, image: Buffer, options?: SendMediaOptions): Promise<MessageResult>;

  /**
   * Envia mensagem de áudio
   */
  sendAudioMessage(jid: string, audio: Buffer, options?: SendMediaOptions): Promise<MessageResult>;

  /**
   * Envia mensagem de vídeo
   */
  sendVideoMessage(jid: string, video: Buffer, options?: SendMediaOptions): Promise<MessageResult>;

  /**
   * Envia mensagem de documento
   */
  sendDocumentMessage(
    jid: string,
    document: Buffer,
    options?: SendDocumentOptions,
  ): Promise<MessageResult>;

  /**
   * Obtém informações de perfil
   */
  getProfilePicture(jid: string): Promise<string | null>;

  /**
   * Verifica se número está no WhatsApp
   */
  isOnWhatsApp(phoneNumber: string): Promise<boolean>;

  /**
   * Obtém status da conexão
   */
  getConnectionStatus(): ConnectionStatus;

  /**
   * Marca mensagem como lida
   */
  markAsRead(jid: string, messageIds: string[]): Promise<void>;

  /**
   * Obtém QR Code para autenticação
   */
  getQRCode(): Promise<string | null>;
}

/**
 * Configuração de conexão
 */
export interface WhatsAppConnectionConfig {
  sessionId: string;
  phoneNumber?: string;
  printQRInTerminal?: boolean;
  qrTimeout?: number;
  maxReconnectAttempts?: number;
  reconnectInterval?: number;
}

/**
 * Callbacks de eventos
 */
export interface WhatsAppConnectionUpdate {
  status: ConnectionStatus;
  reason?: string;
  shouldReconnect?: boolean;
}

export interface WhatsAppCallbacks {
  onQR?: (qr: string) => void;
  onConnected?: () => void;
  onDisconnected?: (reason?: string) => void;
  onMessage?: (message: any) => void;
  onConnectionUpdate?: (update: WhatsAppConnectionUpdate) => void;
  onError?: (error: Error) => void;
}

/**
 * Opções para envio de mensagem
 */
export interface SendMessageOptions {
  quotedMessageId?: string;
  mentions?: string[];
}

/**
 * Opções para envio de mídia
 */
export interface SendMediaOptions extends SendMessageOptions {
  caption?: string;
  mimeType?: string;
}

/**
 * Opções para envio de documento
 */
export interface SendDocumentOptions extends SendMediaOptions {
  fileName?: string;
}

/**
 * Resultado de envio de mensagem
 */
export interface MessageResult {
  success: boolean;
  messageId?: string;
  timestamp?: number;
  error?: string;
}

/**
 * Status de conexão
 */
export enum ConnectionStatus {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  QR_PENDING = 'QR_PENDING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR',
}

/**
 * Tipos de provedores suportados
 */
export enum WhatsAppProviderType {
  BAILEYS = 'baileys',
  OFFICIAL_API = 'official_api',
}
