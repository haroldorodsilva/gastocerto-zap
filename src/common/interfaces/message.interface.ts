import { proto } from '@whiskeysockets/baileys';

export interface IMessage {
  key: proto.IMessageKey;
  message?: proto.IMessage;
  messageTimestamp?: number | Long;
  pushName?: string;
  participant?: string;
  isFromMe?: boolean;
}

export interface IFilteredMessage {
  phoneNumber: string; // Na verdade é o platformId (whatsappId ou telegramId)
  messageId: string;
  text?: string;
  imageBuffer?: Buffer;
  audioBuffer?: Buffer;
  mimeType?: string;
  isFromMe: boolean;
  timestamp: number;
  pushName?: string;
  type: MessageType;
  platform: 'whatsapp' | 'telegram'; // Plataforma de origem da mensagem
}

export enum MessageType {
  TEXT = 'text',
  IMAGE = 'image',
  AUDIO = 'audio',
  VIDEO = 'video',
  DOCUMENT = 'document',
  STICKER = 'sticker',
  LOCATION = 'location',
  CONTACT = 'contact',
  UNKNOWN = 'unknown',
}

export interface IMessageFilter {
  isValidMessage(message: IMessage): boolean;
  isFromUser(message: IMessage): boolean;
  isFromGroup(message: IMessage): boolean;
  extractMessageData(message: IMessage): Promise<IFilteredMessage | null>;
}
