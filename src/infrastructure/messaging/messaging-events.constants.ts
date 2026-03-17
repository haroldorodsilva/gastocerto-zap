/**
 * Constantes centralizadas para nomes de eventos de mensageria.
 *
 * Substitui strings hardcoded como 'whatsapp.reply', 'telegram.reply', etc.
 * Garante consistência e permite refatoração segura com Find References.
 */

/** Eventos de resposta (sistema → usuário) */
export const REPLY_EVENTS = {
  WHATSAPP: 'whatsapp.reply',
  TELEGRAM: 'telegram.reply',
} as const;

/** Eventos de mensagem recebida (usuário → sistema) */
export const MESSAGE_EVENTS = {
  WHATSAPP: 'whatsapp.message',
  TELEGRAM: 'telegram.message',
} as const;

/** Eventos de sessão */
export const SESSION_EVENTS = {
  QR: 'session.qr',
  QR_EXPIRED: 'session.qr.expired',
  QR_SCANNED: 'session.qr.scanned',
  CONNECTED: 'session.connected',
  DISCONNECTED: 'session.disconnected',
  STARTED: 'session.started',
  STOPPED: 'session.stopped',
  UPDATE: 'session.update',
  ERROR: 'session.error',
  AUTH_CORRUPTED: 'session.auth.corrupted',
  ERROR_515: 'session.error.515',
  MESSAGE: 'session.message',
  MESSAGE_SENT: 'session.message.sent',
  MESSAGE_RECEIVED: 'session.message.received',
} as const;

/** Eventos de chat/contato */
export const CHAT_EVENTS = {
  MESSAGE_STATUS_UPDATE: 'message.status.update',
  CHAT_UPDATE: 'chat.update',
  CONTACT_UPDATE: 'contact.update',
  TYPING_START: 'typing.start',
  TYPING_STOP: 'typing.stop',
} as const;
