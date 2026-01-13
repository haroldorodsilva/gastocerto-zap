import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SessionsService } from '@infrastructure/messaging/core/services/sessions.service';
import { SessionManagerService } from '@infrastructure/core/session-manager.service';
import { WhatsAppSessionManager } from '../providers/baileys/whatsapp-session-manager.service';
import { WhatsAppChatCacheService } from '@infrastructure/chat/whatsapp-chat-cache.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import {
  CreateSessionDto,
  UpdateSessionDto,
  SessionResponseDto,
  ListSessionsQueryDto,
} from '@infrastructure/messaging/core/dto/session.dto';

/**
 * WhatsAppController
 * Gerenciamento de sessões WhatsApp pelo dashboard admin (Baileys-specific)
 * Rota: /whatsapp
 *
 * Autenticação: JwtAuthGuard
 * - Apenas admin (gastocerto-admin): Authorization: Bearer <jwt>
 * - Requer role ADMIN ou MASTER
 */
@Controller('whatsapp')
@UseGuards(JwtAuthGuard)
export class WhatsAppController {
  private readonly logger = new Logger(WhatsAppController.name);

  constructor(
    private readonly sessionsService: SessionsService,
    private readonly sessionManager: SessionManagerService,
    private readonly whatsappSessionManager: WhatsAppSessionManager,
    private readonly chatCache: WhatsAppChatCacheService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Cria nova sessão WhatsApp
   * POST /sessions
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createSession(@Body() dto: CreateSessionDto): Promise<SessionResponseDto> {
    this.logger.log(`Creating session: ${dto.sessionId} (${dto.phoneNumber})`);
    const session = await this.sessionsService.createSession(dto);

    return {
      id: session.id,
      sessionId: session.sessionId,
      phoneNumber: session.phoneNumber,
      name: session.name || undefined,
      status: session.status,
      isActive: session.isActive,
      lastSeen: session.lastSeen || undefined,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  /**
   * Lista todas as sessões
   * GET /sessions
   */
  @Get()
  async listSessions(@Query() query: ListSessionsQueryDto): Promise<SessionResponseDto[]> {
    const sessions = await this.sessionsService.listSessions(query);

    return sessions.map((session) => {
      // ✅ Verificar se está realmente conectada em memória
      const isReallyConnected = this.whatsappSessionManager.isSessionConnected(session.sessionId);

      return {
        id: session.id,
        sessionId: session.sessionId,
        phoneNumber: session.phoneNumber,
        name: session.name || undefined,
        // ✅ Usar status real da memória, não do banco
        status: isReallyConnected ? 'CONNECTED' : 'DISCONNECTED',
        isActive: session.isActive,
        lastSeen: session.lastSeen || undefined,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      };
    });
  }

  /**
   * Lista sessões ativas
   * GET /whatsapp/active/list
   */
  @Get('active/list')
  async getActiveSessions(): Promise<SessionResponseDto[]> {
    const sessions = await this.sessionsService.getActiveSessions();

    return sessions.map((session) => {
      // ✅ Verificar se está realmente conectada em memória
      const isReallyConnected = this.whatsappSessionManager.isSessionConnected(session.sessionId);

      return {
        id: session.id,
        sessionId: session.sessionId,
        phoneNumber: session.phoneNumber,
        name: session.name || undefined,
        // ✅ Usar status real da memória
        status: isReallyConnected ? 'CONNECTED' : 'DISCONNECTED',
        isActive: session.isActive,
        lastSeen: session.lastSeen || undefined,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      };
    });
  }

  /**
   * Estatísticas de sessões
   * GET /whatsapp/stats/summary
   */
  @Get('stats/summary')
  async getSessionStats() {
    const [total, byStatus, active, connected] = await Promise.all([
      this.sessionsService.countSessions(),
      this.sessionsService.countByStatus(),
      this.sessionsService.getActiveSessions(),
      this.sessionsService.getConnectedSessions(),
    ]);

    // ✅ Contar apenas sessões realmente conectadas em memória
    const reallyConnected = this.whatsappSessionManager.getActiveSessionIds().length;

    return {
      total,
      active: active.length,
      // ✅ Usar contagem real da memória
      connected: reallyConnected,
      // Status do banco (pode estar desatualizado)
      dbConnected: connected.length,
      byStatus,
    };
  }

  /**
   * Busca sessão por ID
   * GET /sessions/:id
   */
  @Get(':id')
  async getSession(@Param('id') id: string): Promise<SessionResponseDto> {
    const session = await this.sessionsService.getSessionById(id);

    // ✅ Verificar se está realmente conectada em memória
    const isReallyConnected = this.whatsappSessionManager.isSessionConnected(session.sessionId);

    return {
      id: session.id,
      sessionId: session.sessionId,
      phoneNumber: session.phoneNumber,
      name: session.name || undefined,
      // ✅ Usar status real da memória
      status: isReallyConnected ? 'CONNECTED' : 'DISCONNECTED',
      isActive: session.isActive,
      lastSeen: session.lastSeen || undefined,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  /**
   * Atualiza sessão
   * PUT /sessions/:id
   */
  @Put(':id')
  async updateSession(
    @Param('id') id: string,
    @Body() dto: UpdateSessionDto,
  ): Promise<SessionResponseDto> {
    this.logger.log(`Updating session: ${id}`);
    const session = await this.sessionsService.updateSession(id, dto);

    return {
      id: session.id,
      sessionId: session.sessionId,
      phoneNumber: session.phoneNumber,
      name: session.name || undefined,
      status: session.status,
      isActive: session.isActive,
      lastSeen: session.lastSeen || undefined,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  /**
   * Ativa sessão (inicia conexão com WhatsApp)
   * POST /sessions/:id/activate
   */
  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  async activateSession(@Param('id') id: string): Promise<SessionResponseDto> {
    this.logger.log(`Activating session: ${id}`);

    // Busca sessão no banco
    const session = await this.sessionsService.getSessionById(id);

    // Inicia sessão via SessionManager
    await this.sessionManager.startSession(session.sessionId);

    // Retorna sessão atualizada
    const updatedSession = await this.sessionsService.getSessionById(id);

    return {
      id: updatedSession.id,
      sessionId: updatedSession.sessionId,
      phoneNumber: updatedSession.phoneNumber,
      name: updatedSession.name || undefined,
      status: updatedSession.status,
      isActive: updatedSession.isActive,
      lastSeen: updatedSession.lastSeen || undefined,
      createdAt: updatedSession.createdAt,
      updatedAt: updatedSession.updatedAt,
    };
  }

  /**
   * Desativa sessão (desconecta do WhatsApp)
   * POST /sessions/:id/deactivate
   */
  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  async deactivateSession(@Param('id') id: string): Promise<SessionResponseDto> {
    this.logger.log(`Deactivating session: ${id}`);

    // Busca sessão no banco
    const session = await this.sessionsService.getSessionById(id);

    // Para sessão via SessionManager
    await this.sessionManager.stopSession(session.sessionId);

    // Retorna sessão atualizada
    const updatedSession = await this.sessionsService.getSessionById(id);

    return {
      id: updatedSession.id,
      sessionId: updatedSession.sessionId,
      phoneNumber: updatedSession.phoneNumber,
      name: updatedSession.name || undefined,
      status: updatedSession.status,
      isActive: updatedSession.isActive,
      lastSeen: updatedSession.lastSeen || undefined,
      createdAt: updatedSession.createdAt,
      updatedAt: updatedSession.updatedAt,
    };
  }

  /**
   * Reseta credenciais corrompidas (requer novo QR code)
   * POST /sessions/:id/reset-auth
   */
  @Post(':id/reset-auth')
  @HttpCode(HttpStatus.OK)
  async resetAuthState(@Param('id') id: string): Promise<SessionResponseDto> {
    this.logger.log(`🔄 Resetting auth state for session: ${id}`);

    // Para sessão se estiver rodando
    try {
      const session = await this.sessionsService.getSessionById(id);
      await this.sessionManager.stopSession(session.sessionId);
    } catch {
      // Ignora erro se sessão não estiver rodando
    }

    // Reseta credenciais
    const updatedSession = await this.sessionsService.resetAuthState(id);

    return {
      id: updatedSession.id,
      sessionId: updatedSession.sessionId,
      phoneNumber: updatedSession.phoneNumber,
      name: updatedSession.name || undefined,
      status: updatedSession.status,
      isActive: updatedSession.isActive,
      lastSeen: updatedSession.lastSeen || undefined,
      createdAt: updatedSession.createdAt,
      updatedAt: updatedSession.updatedAt,
    };
  }

  /**
   * Obtém QR Code da sessão
   * GET /sessions/:id/qr
   */
  @Get(':id/qr')
  async getQRCode(@Param('id') id: string): Promise<{ qr: string | null }> {
    const session = await this.sessionsService.getSessionById(id);
    const qr = await this.sessionManager.getQRCode(session.sessionId);

    if (!qr) {
      throw new NotFoundException(`No QR code available for session ${session.sessionId}`);
    }

    return { qr };
  }

  /**
   * Regenera QR Code da sessão (quando expirado)
   * POST /sessions/:id/regenerate-qr
   *
   * @param id - ID da sessão
   * @returns Novo QR Code
   *
   * @throws NotFoundException - Sessão não encontrada
   * @throws BadRequestException - Sessão não está em estado apropriado
   */
  @Post(':id/regenerate-qr')
  async regenerateQR(@Param('id') id: string): Promise<{ success: boolean; qr: string }> {
    const session = await this.sessionsService.getSessionById(id);

    if (!session) {
      throw new NotFoundException('Sessão não encontrada');
    }

    // Verificar se sessão está em estado apropriado
    if (
      session.status !== 'CONNECTING' &&
      session.status !== 'QR_PENDING' &&
      session.status !== 'INACTIVE'
    ) {
      throw new BadRequestException(
        `Só é possível regenerar QR em estado CONNECTING, QR_PENDING ou INACTIVE. ` +
          `Estado atual: ${session.status}`,
      );
    }

    try {
      // Parar sessão se estiver ativa
      const isSessionActive = this.sessionManager.getSession(session.sessionId);
      if (isSessionActive) {
        await this.sessionManager.stopSession(session.sessionId);
      }

      // Aguardar um pouco para limpar state
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Reiniciar sessão para gerar novo QR
      await this.sessionManager.startSession(session.sessionId);

      // Aguardar novo QR ser gerado (max 15s)
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new BadRequestException('Timeout aguardando novo QR Code'));
        }, 15000);

        // Listener para novo QR
        const qrHandler = (data: { sessionId: string; qr: string }) => {
          if (data.sessionId === session.sessionId) {
            clearTimeout(timeout);
            this.eventEmitter.off('session.qr', qrHandler);
            resolve({
              success: true,
              qr: data.qr,
            });
          }
        };

        this.eventEmitter.on('session.qr', qrHandler);
      });
    } catch (error) {
      this.logger.error(`Erro ao regenerar QR para sessão ${id}:`, error);
      throw new BadRequestException(`Erro ao regenerar QR Code: ${error.message}`);
    }
  }

  /**
   * Envia mensagem de teste
   * POST /sessions/:id/send
   */
  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  async sendMessage(
    @Param('id') id: string,
    @Body() dto: { phoneNumber: string; message: string },
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const session = await this.sessionsService.getSessionById(id);
    const provider = this.sessionManager.getSession(session.sessionId);

    if (!provider) {
      throw new NotFoundException(`Session ${session.sessionId} is not active`);
    }

    // Formata JID do WhatsApp
    const jid = dto.phoneNumber.includes('@')
      ? dto.phoneNumber
      : `${dto.phoneNumber}@s.whatsapp.net`;

    const result = await provider.sendTextMessage(jid, dto.message);
    return result;
  }

  /**
   * Deleta sessão
   * DELETE /sessions/:id
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSession(@Param('id') id: string): Promise<void> {
    this.logger.log(`Deleting session: ${id}`);
    await this.sessionsService.deleteSession(id);
  }

  /**
   * Obtém metadados da sessão ativa (perfil, status)
   * GET /whatsapp/:id/metadata
   */
  @Get(':id/metadata')
  async getSessionMetadata(@Param('id') id: string) {
    const session = await this.sessionsService.getSessionById(id);
    return await this.whatsappSessionManager.getSessionMetadata(session.sessionId);
  }

  /**
   * Busca informações de um contato específico
   * GET /whatsapp/:id/contacts/:phoneNumber
   */
  @Get(':id/contacts/:phoneNumber')
  async getContactProfile(@Param('id') id: string, @Param('phoneNumber') phoneNumber: string) {
    const session = await this.sessionsService.getSessionById(id);
    return await this.whatsappSessionManager.getContactProfile(session.sessionId, phoneNumber);
  }

  /**
   * Verifica se um número existe no WhatsApp
   * GET /whatsapp/:id/check-number/:phoneNumber
   */
  @Get(':id/check-number/:phoneNumber')
  async checkNumberExists(@Param('id') id: string, @Param('phoneNumber') phoneNumber: string) {
    const session = await this.sessionsService.getSessionById(id);
    const exists = await this.whatsappSessionManager.checkNumberExists(
      session.sessionId,
      phoneNumber,
    );
    return {
      phoneNumber,
      exists,
      timestamp: new Date(),
    };
  }

  /**
   * Envia mensagem manual para um número específico
   * POST /whatsapp/:id/send-message
   */
  @Post(':id/send-message')
  @HttpCode(HttpStatus.OK)
  async sendManualMessage(
    @Param('id') id: string,
    @Body()
    body: {
      to: string;
      text?: string;
      caption?: string;
      image?: string;
      document?: { url: string; mimetype: string; fileName: string };
    },
  ) {
    const session = await this.sessionsService.getSessionById(id);

    if (!body.text && !body.image && !body.document) {
      throw new BadRequestException('Provide at least text, image or document');
    }

    const result = await this.whatsappSessionManager.sendAdvancedMessage(
      session.sessionId,
      body.to,
      {
        text: body.text,
        caption: body.caption,
        image: body.image,
        document: body.document,
      },
    );

    if (!result.success) {
      throw new BadRequestException(result.error || 'Failed to send message');
    }

    // Emitir evento de mensagem enviada via WebSocket
    this.eventEmitter.emit('session.message.sent', {
      sessionId: session.sessionId,
      to: body.to,
      messageId: result.messageId,
      text: body.text,
      timestamp: new Date(),
    });

    return {
      success: true,
      messageId: result.messageId,
      to: body.to,
      timestamp: new Date(),
    };
  }

  /**
   * Lista todos os contatos da sessão
   * GET /whatsapp/:id/contacts
   */
  @Get(':id/contacts')
  async getContacts(@Param('id') id: string) {
    const session = await this.sessionsService.getSessionById(id);
    const contacts = await this.whatsappSessionManager.getContacts(session.sessionId);
    return {
      sessionId: session.sessionId,
      total: contacts.length,
      contacts,
    };
  }

  /**
   * Lista todos os chats ativos (incluindo grupos)
   * GET /whatsapp/:id/chats
   *
   * Busca do cache Redis primeiro (rápido), se não encontrar busca do WhatsApp
   */
  @Get(':id/chats')
  async getChats(
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('source') source?: 'cache' | 'whatsapp',
  ) {
    const session = await this.sessionsService.getSessionById(id);

    // Se source=whatsapp, força busca direta
    if (source === 'whatsapp') {
      const chats = await this.whatsappSessionManager.getChats(session.sessionId);
      return {
        sessionId: session.sessionId,
        source: 'whatsapp',
        total: chats.length,
        chats,
      };
    }

    // Tentar buscar do cache primeiro
    const cachedChats = await this.chatCache.getChats(
      session.sessionId,
      limit ? parseInt(limit) : 50,
    );

    // Se encontrou no cache, retorna
    if (cachedChats.length > 0) {
      return {
        sessionId: session.sessionId,
        source: 'cache',
        ttl: 14400,
        total: cachedChats.length,
        chats: cachedChats,
      };
    }

    // Não encontrou no cache, buscar do WhatsApp e cachear
    const chats = await this.whatsappSessionManager.getChats(session.sessionId);

    // Salvar no cache para próximas requests
    for (const chat of chats) {
      await this.chatCache.cacheChat(session.sessionId, {
        chatId: chat.id,
        name: chat.name,
        isGroup: chat.isGroup,
        lastMessageTimestamp: chat.lastMessageTimestamp || Date.now(),
        lastMessageText: undefined, // lastMessage não está disponível no tipo retornado
        unreadCount: chat.unreadCount || 0,
      });
    }

    return {
      sessionId: session.sessionId,
      source: 'whatsapp',
      total: chats.length,
      chats,
    };
  }

  /**
   * Busca metadados de um grupo específico
   * GET /whatsapp/:id/groups/:groupId
   */
  @Get(':id/groups/:groupId')
  async getGroupMetadata(@Param('id') id: string, @Param('groupId') groupId: string) {
    const session = await this.sessionsService.getSessionById(id);
    return await this.whatsappSessionManager.getGroupMetadata(session.sessionId, groupId);
  }

  /**
   * Lista mensagens de um chat específico
   * GET /whatsapp/:id/chats/:chatId/messages
   *
   * Busca do cache Redis primeiro (rápido), se não encontrar busca do WhatsApp
   */
  @Get(':id/chats/:chatId/messages')
  async getChatMessages(
    @Param('id') id: string,
    @Param('chatId') chatId: string,
    @Query('limit') limit?: string,
    @Query('source') source?: 'cache' | 'whatsapp',
  ) {
    const session = await this.sessionsService.getSessionById(id);
    const messageLimit = limit ? parseInt(limit) : 50;

    // Se source=whatsapp, força busca direta
    if (source === 'whatsapp') {
      const messages = await this.whatsappSessionManager.getChatMessages(
        session.sessionId,
        chatId,
        messageLimit,
      );
      return {
        sessionId: session.sessionId,
        chatId,
        source: 'whatsapp',
        total: messages.length,
        messages,
      };
    }

    // Tentar buscar do cache primeiro
    const cachedMessages = await this.chatCache.getChatMessages(
      session.sessionId,
      chatId,
      messageLimit,
    );

    // Se encontrou no cache, retorna
    if (cachedMessages.length > 0) {
      // Marcar como lido ao buscar mensagens
      await this.chatCache.resetUnreadCount(session.sessionId, chatId);

      return {
        sessionId: session.sessionId,
        chatId,
        source: 'cache',
        ttl: 14400,
        total: cachedMessages.length,
        messages: cachedMessages,
      };
    }

    // Não encontrou no cache, buscar do WhatsApp
    const messages = await this.whatsappSessionManager.getChatMessages(
      session.sessionId,
      chatId,
      messageLimit,
    );

    return {
      sessionId: session.sessionId,
      chatId,
      source: 'whatsapp',
      total: messages.length,
      messages,
    };
  }

  /**
   * Limpa o cache de uma sessão
   * DELETE /whatsapp/:id/cache
   */
  @Delete(':id/cache')
  @HttpCode(HttpStatus.OK)
  async clearSessionCache(@Param('id') id: string) {
    const session = await this.sessionsService.getSessionById(id);
    await this.chatCache.clearSessionCache(session.sessionId);

    return {
      success: true,
      message: `Cache cleared for session ${session.sessionId}`,
    };
  }

  /**
   * Sincroniza chats para o cache
   * POST /whatsapp/:id/sync-cache
   */
  @Post(':id/sync-cache')
  @HttpCode(HttpStatus.OK)
  async syncChatsToCache(@Param('id') id: string) {
    const session = await this.sessionsService.getSessionById(id);

    // Buscar chats diretamente do WhatsApp
    const chats = await this.whatsappSessionManager.getChats(session.sessionId);

    // Salvar cada chat no cache
    let cached = 0;
    for (const chat of chats) {
      await this.chatCache.cacheChat(session.sessionId, {
        chatId: chat.id,
        name: chat.name,
        isGroup: chat.isGroup,
        lastMessageTimestamp: chat.lastMessageTimestamp || Date.now(),
        lastMessageText: undefined, // lastMessage não está disponível no tipo retornado
        unreadCount: chat.unreadCount || 0,
      });
      cached++;
    }

    return {
      success: true,
      sessionId: session.sessionId,
      totalChats: chats.length,
      cached,
      message: `${cached} chats synchronized to cache`,
    };
  }

  /**
   * Marca mensagens de um chat como lidas (reseta contador)
   * POST /whatsapp/:id/chats/:chatId/mark-read
   */
  @Post(':id/chats/:chatId/mark-read')
  @HttpCode(HttpStatus.OK)
  async markChatAsRead(@Param('id') id: string, @Param('chatId') chatId: string) {
    const session = await this.sessionsService.getSessionById(id);
    await this.chatCache.resetUnreadCount(session.sessionId, chatId);

    return {
      success: true,
      sessionId: session.sessionId,
      chatId,
      message: 'Chat marked as read',
    };
  }

  /**
   * Atualiza configurações da sessão
   * PATCH /whatsapp/:id/settings
   */
  @Put(':id/settings')
  async updateSessionSettings(
    @Param('id') id: string,
    @Body()
    settings: {
      name?: string;
      autoStart?: boolean;
      webhookUrl?: string;
    },
  ) {
    const session = await this.sessionsService.updateSession(id, settings);

    return {
      success: true,
      session: {
        id: session.id,
        sessionId: session.sessionId,
        name: session.name,
      },
    };
  }

  /**
   * Status detalhado da sessão (inclui cache e conexão)
   * GET /whatsapp/:id/status/detailed
   */
  @Get(':id/status/detailed')
  async getDetailedStatus(@Param('id') id: string) {
    const session = await this.sessionsService.getSessionById(id);
    const isConnected = this.whatsappSessionManager.isSessionConnected(session.sessionId);

    // Buscar estatísticas do cache
    const cachedChats = await this.chatCache.getChats(session.sessionId, 1000);

    let totalCachedMessages = 0;
    for (const chat of cachedChats) {
      const messages = await this.chatCache.getChatMessages(session.sessionId, chat.chatId, 1000);
      totalCachedMessages += messages.length;
    }

    return {
      session: {
        id: session.id,
        sessionId: session.sessionId,
        phoneNumber: session.phoneNumber,
        name: session.name,
        status: isConnected ? 'CONNECTED' : session.status,
        isActive: session.isActive,
        lastSeen: session.lastSeen,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      },
      connection: {
        isConnected,
        inMemory: this.sessionManager.getSession(session.sessionId) !== undefined,
      },
      cache: {
        totalChats: cachedChats.length,
        totalMessages: totalCachedMessages,
        ttl: 14400, // 4 horas
        chatsWithUnread: cachedChats.filter((c) => c.unreadCount > 0).length,
      },
    };
  }

  /**
   * Deleta uma mensagem específica
   * DELETE /whatsapp/:id/chats/:chatId/messages/:messageId
   */
  @Delete(':id/chats/:chatId/messages/:messageId')
  @HttpCode(HttpStatus.OK)
  async deleteMessage(
    @Param('id') id: string,
    @Param('chatId') chatId: string,
    @Param('messageId') messageId: string,
  ) {
    const session = await this.sessionsService.getSessionById(id);
    const success = await this.whatsappSessionManager.deleteMessage(
      session.sessionId,
      messageId,
      chatId,
    );

    return {
      success,
      sessionId: session.sessionId,
      chatId,
      messageId,
      message: 'Message deleted successfully',
    };
  }

  /**
   * Limpa todas as mensagens de um chat
   * DELETE /whatsapp/:id/chats/:chatId/messages
   */
  @Delete(':id/chats/:chatId/messages')
  @HttpCode(HttpStatus.OK)
  async clearChat(@Param('id') id: string, @Param('chatId') chatId: string) {
    const session = await this.sessionsService.getSessionById(id);
    const success = await this.whatsappSessionManager.clearChat(session.sessionId, chatId);

    // Limpar cache também
    await this.chatCache.clearSessionCache(session.sessionId);

    return {
      success,
      sessionId: session.sessionId,
      chatId,
      message: 'Chat cleared successfully',
    };
  }

  /**
   * Exporta mensagens de um chat (JSON)
   * POST /whatsapp/:id/chats/:chatId/export
   */
  @Post(':id/chats/:chatId/export')
  @HttpCode(HttpStatus.OK)
  async exportChat(
    @Param('id') id: string,
    @Param('chatId') chatId: string,
    @Query('limit') limit?: string,
  ) {
    const session = await this.sessionsService.getSessionById(id);
    const messages = await this.whatsappSessionManager.exportChat(
      session.sessionId,
      chatId,
      limit ? parseInt(limit) : 100,
    );

    return {
      success: true,
      sessionId: session.sessionId,
      chatId,
      total: messages.length,
      messages,
      exportedAt: new Date().toISOString(),
    };
  }

  /**
   * Bloqueia um contato
   * POST /whatsapp/:id/contacts/:phoneNumber/block
   */
  @Post(':id/contacts/:phoneNumber/block')
  @HttpCode(HttpStatus.OK)
  async blockContact(@Param('id') id: string, @Param('phoneNumber') phoneNumber: string) {
    const session = await this.sessionsService.getSessionById(id);
    const success = await this.whatsappSessionManager.blockContact(session.sessionId, phoneNumber);

    return {
      success,
      sessionId: session.sessionId,
      phoneNumber,
      status: 'blocked',
      message: `Contact ${phoneNumber} blocked successfully`,
    };
  }

  /**
   * Desbloqueia um contato
   * POST /whatsapp/:id/contacts/:phoneNumber/unblock
   */
  @Post(':id/contacts/:phoneNumber/unblock')
  @HttpCode(HttpStatus.OK)
  async unblockContact(@Param('id') id: string, @Param('phoneNumber') phoneNumber: string) {
    const session = await this.sessionsService.getSessionById(id);
    const success = await this.whatsappSessionManager.unblockContact(
      session.sessionId,
      phoneNumber,
    );

    return {
      success,
      sessionId: session.sessionId,
      phoneNumber,
      status: 'unblocked',
      message: `Contact ${phoneNumber} unblocked successfully`,
    };
  }
}
