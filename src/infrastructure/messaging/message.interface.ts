import { proto } from '@whiskeysockets/baileys';
import { MessageType } from './messaging-provider.interface';

export { MessageType };

export interface IMessage {
  key: proto.IMessageKey;
  message?: proto.IMessage;
  messageTimestamp?: number | Long;
  pushName?: string;
  participant?: string;
  isFromMe?: boolean;
}

export interface IFilteredMessage {
  platformId: string; // ID do usuário na plataforma (whatsappId, telegramChatId, webchat-{userId})
  phoneNumber: string; // Alias para platformId — mantido para compatibilidade
  userId?: string; // ID interno do usuário (gastoCertoId) — preenchido após lookup
  messageId: string;
  text?: string;
  imageBuffer?: Buffer;
  audioBuffer?: Buffer;
  documentBuffer?: Buffer; // Buffer do documento (PDF, etc)
  fileName?: string; // Nome original do arquivo
  mimeType?: string;
  isFromMe: boolean;
  timestamp: number;
  pushName?: string;
  type: MessageType;
  platform: 'whatsapp' | 'telegram' | 'webchat'; // Plataforma de origem da mensagem
}

// MessageType is now imported from messaging-provider.interface.ts and re-exported above

export interface IMessageFilter {
  isValidMessage(message: IMessage): boolean;
  isFromUser(message: IMessage): boolean;
  isFromGroup(message: IMessage): boolean;
  extractMessageData(message: IMessage): Promise<IFilteredMessage | null>;
}
