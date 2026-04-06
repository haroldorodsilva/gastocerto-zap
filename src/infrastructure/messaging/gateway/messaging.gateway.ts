import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger, UnauthorizedException } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtValidationService } from '@common/services/jwt-validation.service';
import { SESSION_EVENTS, CHAT_EVENTS } from '../messaging-events.constants';

interface ClientData {
  sessionIds: Set<string>;
  userId?: string;
  userRole?: string;
}

/**
 * WebSocket Gateway for real-time communication
 * Emite eventos de QR code, status de conexão e mensagens
 * 
 * Suporta múltiplas plataformas: WhatsApp, Telegram, etc.
 */
@WebSocketGateway({
  cors: {
    origin: process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim())
      : '*',
    credentials: true,
  },
  namespace: '/ws',
})
export class MessagingGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(MessagingGateway.name);
  private readonly clients = new Map<string, ClientData>();

  constructor(private readonly jwtValidationService: JwtValidationService) {}

  afterInit() {
    this.logger.log('✅ WebSocket Gateway initialized on /ws');
  }

  async handleConnection(client: Socket) {
    try {
      // Extrair token do handshake
      const token = this.extractToken(client);

      if (!token) {
        this.logger.warn(`❌ Client ${client.id} rejected - No token provided`);
        client.emit('error', { message: 'Authentication required' });
        client.disconnect();
        return;
      }

      // Validar token JWT
      const user = await this.jwtValidationService.validateToken(token);

      if (!user) {
        this.logger.warn(`❌ Client ${client.id} rejected - Invalid token`);
        client.emit('error', { message: 'Invalid or expired token' });
        client.disconnect();
        return;
      }

      // Armazenar dados do cliente autenticado
      this.clients.set(client.id, {
        sessionIds: new Set(),
        userId: user.id,
        userRole: user.role,
      });

      this.logger.log(`🔌 Client ${client.id} connected (User: ${user.email}, Role: ${user.role})`);
      client.emit('connected', {
        message: 'Connected to GastoCerto-ZAP',
        user: { id: user.id, email: user.email, role: user.role },
      });
    } catch (error) {
      this.logger.error(`❌ Error authenticating client ${client.id}:`, error);
      client.emit('error', { message: 'Authentication failed' });
      client.disconnect();
    }
  }

  private extractToken(client: Socket): string | null {
    // Tentar extrair token de diferentes fontes
    const authHeader = client.handshake.headers.authorization;

    if (authHeader) {
      const parts = authHeader.split(' ');
      if (parts.length === 2 && parts[0] === 'Bearer') {
        return parts[1];
      }
    }

    // Tentar extrair do query string
    const token = client.handshake.query.token as string;
    if (token) {
      return token;
    }

    // Tentar extrair do auth object
    const authToken = client.handshake.auth?.token;
    if (authToken) {
      return authToken;
    }

    return null;
  }

  handleDisconnect(client: Socket) {
    const clientData = this.clients.get(client.id);
    if (clientData) {
      this.logger.log(`📴 Client ${client.id} disconnected`);
      this.clients.delete(client.id);
    }
  }

  /**
   * Client subscribes to session events
   */
  @SubscribeMessage('subscribe:session')
  handleSubscribeSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string },
  ) {
    const clientData = this.clients.get(client.id);
    if (!clientData) {
      client.emit('error', { message: 'Client not authenticated' });
      return;
    }

    // Validar se sessionId foi fornecido
    if (!data?.sessionId) {
      client.emit('error', { message: 'sessionId is required' });
      return;
    }

    // Apenas ADMIN e MASTER podem se inscrever em sessões (as sessões não têm accountId no modelo, o controle é por role)
    if (!['ADMIN', 'MASTER'].includes(clientData.userRole || '')) {
      this.logger.warn(
        `❌ Client ${client.id} (User: ${clientData.userId}) denied access to session ${data.sessionId} - Insufficient permissions`,
      );
      client.emit('error', { message: 'Insufficient permissions' });
      return;
    }

    clientData.sessionIds.add(data.sessionId);
    client.join(`session:${data.sessionId}`);

    this.logger.log(
      `📡 Client ${client.id} (User: ${clientData.userId}) subscribed to session ${data.sessionId}`,
    );

    client.emit('subscribed', { sessionId: data.sessionId });
  }

  /**
   * Client unsubscribes from session events
   */
  @SubscribeMessage('unsubscribe:session')
  handleUnsubscribeSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { sessionId: string },
  ) {
    const clientData = this.clients.get(client.id);
    if (!clientData) {
      client.emit('error', { message: 'Client not authenticated' });
      return;
    }

    if (!data?.sessionId) {
      client.emit('error', { message: 'sessionId is required' });
      return;
    }

    clientData.sessionIds.delete(data.sessionId);
    client.leave(`session:${data.sessionId}`);

    this.logger.log(
      `🔇 Client ${client.id} (User: ${clientData.userId}) unsubscribed from session ${data.sessionId}`,
    );

    client.emit('unsubscribed', { sessionId: data.sessionId });
  }

  /**
   * Event listeners for session events
   */

  @OnEvent(SESSION_EVENTS.QR)
  handleQRCode(payload: { sessionId: string; qr: string }) {
    this.logger.log(`📱 QR code generated for session ${payload.sessionId}`);
    
    // Verificar quantos clientes estão inscritos nesta sessão
    const roomName = `session:${payload.sessionId}`;
    const sockets = this.server.in(roomName).allSockets();
    
    sockets.then((socketIds) => {
      const subscribedClients = socketIds.size;
      this.logger.log(`📊 Clients subscribed to ${roomName}: ${subscribedClients}`);
      
      // Se não houver clientes inscritos, emitir para todos
      if (subscribedClients === 0) {
        this.logger.log(`📡 No subscribed clients, broadcasting QR to all connected clients`);
      }
    });

    // Emit to all clients subscribed to this session
    this.server.to(roomName).emit('qr', {
      sessionId: payload.sessionId,
      qr: payload.qr,
      timestamp: new Date(),
    });
    
    // Sempre fazer broadcast também para garantir que todos recebam
    this.server.emit('qr', {
      sessionId: payload.sessionId,
      qr: payload.qr,
      timestamp: new Date(),
    });
  }

  @OnEvent(SESSION_EVENTS.QR_EXPIRED)
  handleQRExpired(payload: { sessionId: string }) {
    this.logger.log(`⏰ QR code expired for session ${payload.sessionId}`);

    this.server.to(`session:${payload.sessionId}`).emit('qr:expired', {
      sessionId: payload.sessionId,
      timestamp: new Date(),
    });
  }

  @OnEvent(SESSION_EVENTS.QR_SCANNED)
  handleQRScanned(payload: { sessionId: string; success: boolean }) {
    this.logger.log(`✅ QR code scanned for session ${payload.sessionId}`);

    // Emit to room subscribers
    this.server.to(`session:${payload.sessionId}`).emit('qr:scanned', {
      sessionId: payload.sessionId,
      success: payload.success,
      timestamp: new Date(),
    });

    // Broadcast to all connected clients
    this.server.emit('qr:scanned', {
      sessionId: payload.sessionId,
      success: payload.success,
      timestamp: new Date(),
    });
  }

  @OnEvent(SESSION_EVENTS.CONNECTED)
  handleSessionConnected(payload: { sessionId: string }) {
    this.logger.log(`✅ Session ${payload.sessionId} connected`);

    this.server.to(`session:${payload.sessionId}`).emit('session:connected', {
      sessionId: payload.sessionId,
      timestamp: new Date(),
    });
  }

  @OnEvent(SESSION_EVENTS.DISCONNECTED)
  handleSessionDisconnected(payload: { sessionId: string; reason?: string }) {
    this.logger.log(`📴 Session ${payload.sessionId} disconnected: ${payload.reason}`);

    this.server.to(`session:${payload.sessionId}`).emit('session:disconnected', {
      sessionId: payload.sessionId,
      reason: payload.reason,
      timestamp: new Date(),
    });
  }

  @OnEvent(SESSION_EVENTS.MESSAGE_SENT)
  handleMessageSent(payload: {
    sessionId: string;
    to: string;
    messageId: string;
    text?: string;
    timestamp: Date;
  }) {
    this.logger.log(`📤 Message sent in session ${payload.sessionId} to ${payload.to}`);

    // Emit to room subscribers
    this.server.to(`session:${payload.sessionId}`).emit('message:sent', {
      sessionId: payload.sessionId,
      to: payload.to,
      messageId: payload.messageId,
      text: payload.text,
      timestamp: payload.timestamp,
    });

    // Broadcast to all connected clients
    this.server.emit('message:sent', {
      sessionId: payload.sessionId,
      to: payload.to,
      messageId: payload.messageId,
      text: payload.text,
      timestamp: payload.timestamp,
    });
  }

  @OnEvent(SESSION_EVENTS.MESSAGE_RECEIVED)
  handleMessageReceived(payload: {
    sessionId: string;
    from: string;
    messageId: string;
    text?: string;
    fromMe: boolean;
    timestamp: number;
  }) {
    this.logger.log(`📥 Message received in session ${payload.sessionId} from ${payload.from}`);

    // Emit to room subscribers
    this.server.to(`session:${payload.sessionId}`).emit('message:received', {
      sessionId: payload.sessionId,
      from: payload.from,
      messageId: payload.messageId,
      text: payload.text,
      fromMe: payload.fromMe,
      timestamp: payload.timestamp,
    });

    // Broadcast to all connected clients
    this.server.emit('message:received', {
      sessionId: payload.sessionId,
      from: payload.from,
      messageId: payload.messageId,
      text: payload.text,
      fromMe: payload.fromMe,
      timestamp: payload.timestamp,
    });
  }

  @OnEvent(SESSION_EVENTS.STARTED)
  handleSessionStarted(payload: { sessionId: string }) {
    this.logger.log(`🚀 Session ${payload.sessionId} started`);

    this.server.to(`session:${payload.sessionId}`).emit('session:started', {
      sessionId: payload.sessionId,
      timestamp: new Date(),
    });
  }

  @OnEvent(SESSION_EVENTS.STOPPED)
  handleSessionStopped(payload: { sessionId: string }) {
    this.logger.log(`🔴 Session ${payload.sessionId} stopped`);

    this.server.to(`session:${payload.sessionId}`).emit('session:stopped', {
      sessionId: payload.sessionId,
      timestamp: new Date(),
    });
  }

  @OnEvent(SESSION_EVENTS.UPDATE)
  handleSessionUpdate(payload: { sessionId: string; update: any }) {
    this.server.to(`session:${payload.sessionId}`).emit('session:update', {
      sessionId: payload.sessionId,
      update: payload.update,
      timestamp: new Date(),
    });
  }

  @OnEvent(SESSION_EVENTS.MESSAGE)
  handleSessionMessage(payload: { sessionId: string; message: any }) {
    this.server.to(`session:${payload.sessionId}`).emit('session:message', {
      sessionId: payload.sessionId,
      message: payload.message,
      timestamp: new Date(),
    });
  }

  @OnEvent(SESSION_EVENTS.ERROR)
  handleSessionError(payload: { sessionId: string; error: Error }) {
    this.logger.error(`❌ Session ${payload.sessionId} error: ${payload.error.message}`);

    this.server.to(`session:${payload.sessionId}`).emit('session:error', {
      sessionId: payload.sessionId,
      error: {
        message: payload.error.message,
        name: payload.error.name,
      },
      timestamp: new Date(),
    });
  }

  @OnEvent(SESSION_EVENTS.AUTH_CORRUPTED)
  handleAuthCorrupted(payload: { sessionId: string; message: string }) {
    this.logger.error(`🔐 Corrupted auth for ${payload.sessionId}`);

    this.server.to(`session:${payload.sessionId}`).emit('session:auth:corrupted', {
      sessionId: payload.sessionId,
      message: payload.message,
      timestamp: new Date(),
    });
  }

  @OnEvent(SESSION_EVENTS.ERROR_515)
  handleError515(payload: { sessionId: string; message: string }) {
    this.logger.warn(`⚠️  Error 515 for ${payload.sessionId}`);

    this.server.to(`session:${payload.sessionId}`).emit('session:error:515', {
      sessionId: payload.sessionId,
      message: payload.message,
      timestamp: new Date(),
    });
  }

  @OnEvent(CHAT_EVENTS.MESSAGE_STATUS_UPDATE)
  handleMessageStatusUpdate(payload: {
    sessionId: string;
    messageId: string;
    chatId: string;
    status: any;
  }) {
    this.logger.debug(`📊 Message status updated: ${payload.messageId}`);

    this.server.to(`session:${payload.sessionId}`).emit('message:status:update', {
      sessionId: payload.sessionId,
      messageId: payload.messageId,
      chatId: payload.chatId,
      status: payload.status,
      timestamp: new Date(),
    });
  }

  @OnEvent(CHAT_EVENTS.CHAT_UPDATE)
  handleChatUpdate(payload: { sessionId: string; chatId: string; unreadCount?: number }) {
    this.logger.debug(`💬 Chat updated: ${payload.chatId}`);

    this.server.to(`session:${payload.sessionId}`).emit('chat:update', {
      sessionId: payload.sessionId,
      chatId: payload.chatId,
      unreadCount: payload.unreadCount,
      timestamp: new Date(),
    });
  }

  @OnEvent(CHAT_EVENTS.CONTACT_UPDATE)
  handleContactUpdate(payload: {
    sessionId: string;
    contactId: string;
    name?: string;
    notify?: string;
  }) {
    this.logger.debug(`👤 Contact updated: ${payload.contactId}`);

    this.server.to(`session:${payload.sessionId}`).emit('contact:update', {
      sessionId: payload.sessionId,
      contactId: payload.contactId,
      name: payload.name,
      notify: payload.notify,
      timestamp: new Date(),
    });
  }

  @OnEvent(CHAT_EVENTS.TYPING_START)
  handleTypingStart(payload: { sessionId: string; chatId: string; participantId: string }) {
    this.logger.debug(`✍️  Typing started in ${payload.chatId}`);

    this.server.to(`session:${payload.sessionId}`).emit('typing:start', {
      sessionId: payload.sessionId,
      chatId: payload.chatId,
      participantId: payload.participantId,
      timestamp: new Date(),
    });
  }

  @OnEvent(CHAT_EVENTS.TYPING_STOP)
  handleTypingStop(payload: { sessionId: string; chatId: string; participantId: string }) {
    this.logger.debug(`✋ Typing stopped in ${payload.chatId}`);

    this.server.to(`session:${payload.sessionId}`).emit('typing:stop', {
      sessionId: payload.sessionId,
      chatId: payload.chatId,
      participantId: payload.participantId,
      timestamp: new Date(),
    });
  }

  /**
   * Broadcast message to all connected clients
   */
  broadcast(event: string, data: any) {
    this.server.emit(event, data);
  }

  /**
   * Send message to specific session subscribers
   */
  emitToSession(sessionId: string, event: string, data: any) {
    this.server.to(`session:${sessionId}`).emit(event, data);
  }
}
