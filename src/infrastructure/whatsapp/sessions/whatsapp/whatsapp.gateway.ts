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

interface ClientData {
  sessionIds: Set<string>;
  userId?: string;
  userRole?: string;
}

/**
 * WebSocket Gateway for real-time communication
 * Emite eventos de QR code, status de conexão e mensagens
 */
@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  namespace: '/ws',
})
export class WhatsAppGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(WhatsAppGateway.name);
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

    // TODO: Verificar se o usuário tem permissão para acessar esta sessão
    // Por enquanto, apenas ADMIN e MASTER podem se inscrever em qualquer sessão
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

  @OnEvent('session.qr')
  handleQRCode(payload: { sessionId: string; qr: string }) {
    this.logger.log(`📱 QR code generated for session ${payload.sessionId}`);

    // Emit to all clients subscribed to this session
    this.server.to(`session:${payload.sessionId}`).emit('qr', {
      sessionId: payload.sessionId,
      qr: payload.qr,
      timestamp: new Date(),
    });
  }

  @OnEvent('session.qr.expired')
  handleQRExpired(payload: { sessionId: string }) {
    this.logger.log(`⏰ QR code expired for session ${payload.sessionId}`);

    this.server.to(`session:${payload.sessionId}`).emit('qr:expired', {
      sessionId: payload.sessionId,
      timestamp: new Date(),
    });
  }

  @OnEvent('session.connected')
  handleSessionConnected(payload: { sessionId: string }) {
    this.logger.log(`✅ Session ${payload.sessionId} connected`);

    this.server.to(`session:${payload.sessionId}`).emit('session:connected', {
      sessionId: payload.sessionId,
      timestamp: new Date(),
    });
  }

  @OnEvent('session.disconnected')
  handleSessionDisconnected(payload: { sessionId: string; reason?: string }) {
    this.logger.log(`📴 Session ${payload.sessionId} disconnected: ${payload.reason}`);

    this.server.to(`session:${payload.sessionId}`).emit('session:disconnected', {
      sessionId: payload.sessionId,
      reason: payload.reason,
      timestamp: new Date(),
    });
  }

  @OnEvent('session.started')
  handleSessionStarted(payload: { sessionId: string }) {
    this.logger.log(`🚀 Session ${payload.sessionId} started`);

    this.server.to(`session:${payload.sessionId}`).emit('session:started', {
      sessionId: payload.sessionId,
      timestamp: new Date(),
    });
  }

  @OnEvent('session.stopped')
  handleSessionStopped(payload: { sessionId: string }) {
    this.logger.log(`🔴 Session ${payload.sessionId} stopped`);

    this.server.to(`session:${payload.sessionId}`).emit('session:stopped', {
      sessionId: payload.sessionId,
      timestamp: new Date(),
    });
  }

  @OnEvent('session.update')
  handleSessionUpdate(payload: { sessionId: string; update: any }) {
    this.server.to(`session:${payload.sessionId}`).emit('session:update', {
      sessionId: payload.sessionId,
      update: payload.update,
      timestamp: new Date(),
    });
  }

  @OnEvent('session.message')
  handleSessionMessage(payload: { sessionId: string; message: any }) {
    this.server.to(`session:${payload.sessionId}`).emit('session:message', {
      sessionId: payload.sessionId,
      message: payload.message,
      timestamp: new Date(),
    });
  }

  @OnEvent('session.error')
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

  @OnEvent('session.auth.corrupted')
  handleAuthCorrupted(payload: { sessionId: string; message: string }) {
    this.logger.error(`🔐 Corrupted auth for ${payload.sessionId}`);

    this.server.to(`session:${payload.sessionId}`).emit('session:auth:corrupted', {
      sessionId: payload.sessionId,
      message: payload.message,
      timestamp: new Date(),
    });
  }

  @OnEvent('session.error.515')
  handleError515(payload: { sessionId: string; message: string }) {
    this.logger.warn(`⚠️  Error 515 for ${payload.sessionId}`);

    this.server.to(`session:${payload.sessionId}`).emit('session:error:515', {
      sessionId: payload.sessionId,
      message: payload.message,
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
