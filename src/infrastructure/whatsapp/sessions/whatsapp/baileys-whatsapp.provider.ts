import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import makeWASocket, { DisconnectReason, WASocket } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import {
  IWhatsAppProvider,
  WhatsAppConnectionConfig,
  WhatsAppCallbacks,
  ConnectionStatus,
  SendMessageOptions,
  SendMediaOptions,
  SendDocumentOptions,
  MessageResult,
} from '@common/interfaces/whatsapp-provider.interface';

/**
 * Baileys WhatsApp Provider
 * Implementação concreta usando @whiskeysockets/baileys
 */
@Injectable()
export class BaileysWhatsAppProvider implements IWhatsAppProvider {
  private readonly logger = new Logger(BaileysWhatsAppProvider.name);
  private socket: WASocket | null = null;
  private connectionStatus: ConnectionStatus = ConnectionStatus.DISCONNECTED;
  private qrCode: string | null = null;
  private callbacks: WhatsAppCallbacks = {};

  constructor(private readonly configService: ConfigService) {}

  async initialize(config: WhatsAppConnectionConfig, callbacks: WhatsAppCallbacks): Promise<void> {
    try {
      this.callbacks = callbacks;
      this.connectionStatus = ConnectionStatus.CONNECTING;

      this.socket = makeWASocket({
        auth: (config as any).authState,
        printQRInTerminal: config.printQRInTerminal || false,
        browser: ['GastoCerto', 'Chrome', '10.0'],
        logger: this.createLogger(),
        getMessage: async (key) => {
          return undefined;
        },
        defaultQueryTimeoutMs: 60000,
      });

      // Handle connection updates
      this.socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        // Handle QR code
        if (qr) {
          this.qrCode = qr;
          this.connectionStatus = ConnectionStatus.QR_PENDING;

          if (this.callbacks.onQR) {
            this.callbacks.onQR(qr);
          }
        }

        // Handle connection status changes
        if (connection === 'close') {
          const shouldReconnect = this.shouldReconnect(lastDisconnect);
          this.connectionStatus = ConnectionStatus.DISCONNECTED;

          const reason = this.extractDisconnectReason(lastDisconnect);

          // Log detailed error information (especially for error 515)
          if (lastDisconnect?.error) {
            const error = lastDisconnect.error;
            if (error instanceof Boom) {
              const statusCode = error.output?.statusCode;

              // Log error 515 (stream:error) in detail like gasto-zap-api
              if (statusCode === 515 || error.data?.node?.attrs?.code === '515') {
                this.logger.error(
                  `Stream error 515 detected: ${JSON.stringify(error.data?.node || error.output)}`,
                );
              } else if (statusCode) {
                this.logger.debug(`Disconnect reason: ${statusCode} - ${reason}`);
              }
            } else {
              this.logger.error(`Disconnect error: ${JSON.stringify(lastDisconnect.error)}`);
            }
          }

          if (this.callbacks.onDisconnected) {
            this.callbacks.onDisconnected(reason);
          }

          if (this.callbacks.onConnectionUpdate) {
            this.callbacks.onConnectionUpdate({
              status: ConnectionStatus.DISCONNECTED,
              reason,
              shouldReconnect,
            });
          }
        } else if (connection === 'open') {
          this.qrCode = null;
          this.connectionStatus = ConnectionStatus.CONNECTED;

          if (this.callbacks.onConnected) {
            this.callbacks.onConnected();
          }

          if (this.callbacks.onConnectionUpdate) {
            this.callbacks.onConnectionUpdate({
              status: ConnectionStatus.CONNECTED,
            });
          }

          this.logger.log(`✅ Session ${config.sessionId} connected`);
        } else if (connection === 'connecting') {
          this.connectionStatus = ConnectionStatus.CONNECTING;

          if (this.callbacks.onConnectionUpdate) {
            this.callbacks.onConnectionUpdate({
              status: ConnectionStatus.CONNECTING,
            });
          }
        }
      });

      // Handle incoming messages
      this.socket.ev.on('messages.upsert', ({ messages }) => {
        if (this.callbacks.onMessage) {
          messages.forEach((msg) => {
            this.callbacks.onMessage!(msg);
          });
        }
      });

      // Handle credentials update
      this.socket.ev.on('creds.update', (creds) => {
        if ((config as any).onCredsUpdate) {
          (config as any).onCredsUpdate(creds);
        }
      });
    } catch (error) {
      this.logger.error(`Failed to initialize Baileys: ${error.message}`);
      this.connectionStatus = ConnectionStatus.ERROR;

      if (this.callbacks.onError) {
        this.callbacks.onError(error);
      }

      throw error;
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.socket) {
        this.socket.end(undefined);
        this.socket = null;
      }
      this.connectionStatus = ConnectionStatus.DISCONNECTED;
      this.qrCode = null;

      this.logger.log('Disconnected from WhatsApp');
    } catch (error) {
      this.logger.error(`Error during disconnect: ${error.message}`);
      throw error;
    }
  }

  async sendTextMessage(
    jid: string,
    text: string,
    options?: SendMessageOptions,
  ): Promise<MessageResult> {
    try {
      if (!this.socket) {
        throw new Error('Socket not initialized');
      }

      const message: any = { text };

      if (options?.quotedMessageId) {
        message.quoted = { key: { id: options.quotedMessageId } };
      }

      if (options?.mentions) {
        message.mentions = options.mentions;
      }

      const result = await this.socket.sendMessage(jid, message);

      return {
        success: true,
        messageId: result?.key?.id,
      };
    } catch (error) {
      this.logger.error(`Failed to send text message: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async sendImageMessage(
    jid: string,
    image: Buffer,
    options?: SendMediaOptions,
  ): Promise<MessageResult> {
    try {
      if (!this.socket) {
        throw new Error('Socket not initialized');
      }

      const message: any = {
        image,
        caption: options?.caption,
        mimetype: options?.mimeType || 'image/jpeg',
      };

      const result = await this.socket.sendMessage(jid, message);

      return {
        success: true,
        messageId: result?.key?.id,
      };
    } catch (error) {
      this.logger.error(`Failed to send image: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async sendAudioMessage(
    jid: string,
    audio: Buffer,
    options?: SendMediaOptions,
  ): Promise<MessageResult> {
    try {
      if (!this.socket) {
        throw new Error('Socket not initialized');
      }

      const message: any = {
        audio,
        mimetype: options?.mimeType || 'audio/ogg; codecs=opus',
        ptt: true, // Push to talk (voice message)
      };

      const result = await this.socket.sendMessage(jid, message);

      return {
        success: true,
        messageId: result?.key?.id,
      };
    } catch (error) {
      this.logger.error(`Failed to send audio: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async sendVideoMessage(
    jid: string,
    video: Buffer,
    options?: SendMediaOptions,
  ): Promise<MessageResult> {
    try {
      if (!this.socket) {
        throw new Error('Socket not initialized');
      }

      const message: any = {
        video,
        caption: options?.caption,
        mimetype: options?.mimeType || 'video/mp4',
      };

      const result = await this.socket.sendMessage(jid, message);

      return {
        success: true,
        messageId: result?.key?.id,
      };
    } catch (error) {
      this.logger.error(`Failed to send video: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async sendDocumentMessage(
    jid: string,
    document: Buffer,
    options?: SendDocumentOptions,
  ): Promise<MessageResult> {
    try {
      if (!this.socket) {
        throw new Error('Socket not initialized');
      }

      const message: any = {
        document,
        mimetype: options?.mimeType || 'application/pdf',
        fileName: options?.fileName || 'document.pdf',
        caption: options?.caption,
      };

      const result = await this.socket.sendMessage(jid, message);

      return {
        success: true,
        messageId: result?.key?.id,
      };
    } catch (error) {
      this.logger.error(`Failed to send document: ${error.message}`);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async getProfilePicture(jid: string): Promise<string | null> {
    try {
      if (!this.socket) {
        throw new Error('Socket not initialized');
      }

      const url = await this.socket.profilePictureUrl(jid, 'image');
      return url || null;
    } catch {
      this.logger.debug(`No profile picture for ${jid}`);
      return null;
    }
  }

  async isOnWhatsApp(phoneNumber: string): Promise<boolean> {
    try {
      if (!this.socket) {
        throw new Error('Socket not initialized');
      }

      const [result] = await this.socket.onWhatsApp(phoneNumber);
      return !!result?.exists;
    } catch (error) {
      this.logger.error(`Failed to check WhatsApp presence: ${error.message}`);
      return false;
    }
  }

  getConnectionStatus(): ConnectionStatus {
    return this.connectionStatus;
  }

  async markAsRead(jid: string, messageIds: string[]): Promise<void> {
    try {
      if (!this.socket) {
        throw new Error('Socket not initialized');
      }

      for (const messageId of messageIds) {
        await this.socket.readMessages([
          {
            remoteJid: jid,
            id: messageId,
            participant: undefined,
          },
        ]);
      }
    } catch (error) {
      this.logger.error(`Failed to mark messages as read: ${error.message}`);
    }
  }

  async getQRCode(): Promise<string | null> {
    return this.qrCode;
  }

  /**
   * Helper methods
   */

  private shouldReconnect(lastDisconnect: any): boolean {
    const reason = this.extractDisconnectReason(lastDisconnect);

    // Don't reconnect on logout or connection replaced
    if (reason === 'logged_out' || reason === 'connection_replaced') {
      return false;
    }

    return true;
  }

  private extractDisconnectReason(lastDisconnect: any): string {
    if (!lastDisconnect?.error) return 'unknown';

    const error = lastDisconnect.error;
    if (error instanceof Boom) {
      const statusCode = error.output?.statusCode;

      // Check for stream:error with code 515 in data.node.attrs
      if (error.data?.node?.tag === 'stream:error' && error.data?.node?.attrs?.code === '515') {
        return 'stream:error:515';
      }

      switch (statusCode) {
        case DisconnectReason.badSession:
          return 'bad_session';
        case DisconnectReason.connectionClosed:
          return 'connection_closed';
        case DisconnectReason.connectionLost:
          return 'connection_lost';
        case DisconnectReason.connectionReplaced:
          return 'connection_replaced';
        case DisconnectReason.loggedOut:
          return 'logged_out';
        case DisconnectReason.restartRequired:
          return 'restart_required';
        case DisconnectReason.timedOut:
          return 'timed_out';
        case 515:
          return 'stream:error:515';
        default:
          return `status_${statusCode}`;
      }
    }

    return error.message || 'unknown';
  }

  private createLogger(): any {
    return {
      level: 'silent',
      child: () => this.createLogger(),
      trace: () => {},
      debug: () => {},
      info: () => {},
      warn: (msg: any) => this.logger.warn(msg),
      error: (msg: any) => this.logger.error(msg),
    };
  }
}
