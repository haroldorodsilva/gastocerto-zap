import { Injectable, Logger } from '@nestjs/common';
import {
  IMessage,
  IFilteredMessage,
  MessageType,
  IMessageFilter,
} from '@common/interfaces/message.interface';
import { downloadMediaMessage, getContentType } from '@whiskeysockets/baileys';

@Injectable()
export class MessageFilterService implements IMessageFilter {
  private readonly logger = new Logger(MessageFilterService.name);

  /**
   * Verifica se a mensagem é válida para processamento
   */
  isValidMessage(message: IMessage): boolean {
    // Ignorar mensagens vazias
    if (!message || !message.message) {
      return false;
    }

    // Ignorar mensagens próprias (enviadas por nós)
    if (message.key.fromMe) {
      return false;
    }

    // Ignorar mensagens de protocolo (creds_update, etc)
    const messageType = getContentType(message.message);
    if (
      !messageType ||
      messageType === 'protocolMessage' ||
      messageType === 'senderKeyDistributionMessage'
    ) {
      return false;
    }

    return true;
  }

  /**
   * Verifica se a mensagem é de um usuário individual (não grupo)
   */
  isFromUser(message: IMessage): boolean {
    const remoteJid = message.key.remoteJid || '';

    // JID de grupo termina com '@g.us'
    // JID de usuário termina com '@s.whatsapp.net'
    const isGroup = remoteJid.endsWith('@g.us');
    const isBroadcast = remoteJid.endsWith('@broadcast');
    const isStatus = remoteJid === 'status@broadcast';

    return !isGroup && !isBroadcast && !isStatus;
  }

  /**
   * Verifica se a mensagem é de um grupo
   */
  isFromGroup(message: IMessage): boolean {
    const remoteJid = message.key.remoteJid || '';
    return remoteJid.endsWith('@g.us');
  }

  /**
   * Extrai dados relevantes da mensagem
   */
  async extractMessageData(message: IMessage): Promise<IFilteredMessage | null> {
    try {
      // Validações básicas
      if (!this.isValidMessage(message)) {
        return null;
      }

      if (!this.isFromUser(message)) {
        this.logger.debug(`Mensagem de grupo/broadcast ignorada: ${message.key.remoteJid}`);
        return null;
      }

      const messageContent = message.message;
      const messageType = getContentType(messageContent);

      // Extrair número de telefone
      const phoneNumber = this.extractPhoneNumber(message.key.remoteJid || '');
      if (!phoneNumber) {
        this.logger.warn(`Não foi possível extrair número de telefone: ${message.key.remoteJid}`);
        return null;
      }

      // Construir objeto base
      const filteredMessage: IFilteredMessage = {
        phoneNumber,
        messageId: message.key.id || '',
        isFromMe: message.key.fromMe || false,
        timestamp: Number(message.messageTimestamp) || Date.now(),
        pushName: message.pushName,
        type: MessageType.UNKNOWN,
        platform: 'whatsapp', // Por enquanto só temos WhatsApp, depois adicionar Telegram
      };

      // Processar por tipo
      switch (messageType) {
        case 'conversation':
        case 'extendedTextMessage':
          filteredMessage.type = MessageType.TEXT;
          filteredMessage.text = this.extractText(messageContent);
          break;

        case 'imageMessage':
          filteredMessage.type = MessageType.IMAGE;
          filteredMessage.text = messageContent.imageMessage?.caption;
          try {
            const buffer = await downloadMediaMessage(message, 'buffer', {});
            filteredMessage.imageBuffer = buffer as Buffer;
            filteredMessage.mimeType = messageContent.imageMessage?.mimetype;
          } catch (error) {
            this.logger.error(`Erro ao baixar imagem: ${error.message}`);
          }
          break;

        case 'audioMessage':
          filteredMessage.type = MessageType.AUDIO;
          try {
            const buffer = await downloadMediaMessage(message, 'buffer', {});
            filteredMessage.audioBuffer = buffer as Buffer;
            filteredMessage.mimeType = messageContent.audioMessage?.mimetype;
          } catch (error) {
            this.logger.error(`Erro ao baixar áudio: ${error.message}`);
          }
          break;

        case 'videoMessage':
          filteredMessage.type = MessageType.VIDEO;
          filteredMessage.text = messageContent.videoMessage?.caption;
          break;

        case 'documentMessage':
          filteredMessage.type = MessageType.DOCUMENT;
          filteredMessage.text = messageContent.documentMessage?.caption;
          break;

        case 'stickerMessage':
          filteredMessage.type = MessageType.STICKER;
          break;

        case 'locationMessage':
          filteredMessage.type = MessageType.LOCATION;
          break;

        case 'contactMessage':
          filteredMessage.type = MessageType.CONTACT;
          break;

        default:
          this.logger.debug(`Tipo de mensagem não suportado: ${messageType}`);
          return null;
      }

      this.logger.debug(`Mensagem filtrada - Tipo: ${filteredMessage.type}, De: ${phoneNumber}`);

      return filteredMessage;
    } catch (error) {
      this.logger.error(`Erro ao extrair dados da mensagem: ${error.message}`, error.stack);
      return null;
    }
  }

  /**
   * Extrai texto da mensagem
   */
  private extractText(messageContent: any): string | undefined {
    if (messageContent.conversation) {
      return messageContent.conversation;
    }

    if (messageContent.extendedTextMessage?.text) {
      return messageContent.extendedTextMessage.text;
    }

    return undefined;
  }

  /**
   * Extrai número de telefone do JID
   * Exemplo: "5511999999999@s.whatsapp.net" -> "5511999999999"
   */
  private extractPhoneNumber(jid: string): string | null {
    if (!jid) return null;

    // Remover @s.whatsapp.net ou @c.us
    const phone = jid.split('@')[0];

    // Validar se é um número válido (apenas dígitos)
    if (!/^\d+$/.test(phone)) {
      return null;
    }

    return phone;
  }
}
