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
  UseGuards,
} from '@nestjs/common';
import { SessionsService } from '../sessions.service';
import { SessionManagerService } from '../session-manager.service';
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
import {
  CreateSessionDto,
  UpdateSessionDto,
  SessionResponseDto,
  ListSessionsQueryDto,
} from '../dto/session.dto';

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

    return sessions.map((session) => ({
      id: session.id,
      sessionId: session.sessionId,
      phoneNumber: session.phoneNumber,
      name: session.name || undefined,
      status: session.status,
      isActive: session.isActive,
      lastSeen: session.lastSeen || undefined,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    }));
  }

  /**
   * Busca sessão por ID
   * GET /sessions/:id
   */
  @Get(':id')
  async getSession(@Param('id') id: string): Promise<SessionResponseDto> {
    const session = await this.sessionsService.getSessionById(id);

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
    } catch (error) {
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
    const provider = this.sessionManager.getSession(session.sessionId);

    if (!provider) {
      throw new NotFoundException(`Session ${session.sessionId} is not active`);
    }

    const qr = await provider.getQRCode();
    return { qr };
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
   * Lista sessões ativas
   * GET /sessions/active/list
   */
  @Get('active/list')
  async getActiveSessions(): Promise<SessionResponseDto[]> {
    const sessions = await this.sessionsService.getActiveSessions();

    return sessions.map((session) => ({
      id: session.id,
      sessionId: session.sessionId,
      phoneNumber: session.phoneNumber,
      name: session.name || undefined,
      status: session.status,
      isActive: session.isActive,
      lastSeen: session.lastSeen || undefined,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    }));
  }

  /**
   * Estatísticas de sessões
   * GET /sessions/stats/summary
   */
  @Get('stats/summary')
  async getSessionStats() {
    const [total, byStatus, active, connected] = await Promise.all([
      this.sessionsService.countSessions(),
      this.sessionsService.countByStatus(),
      this.sessionsService.getActiveSessions(),
      this.sessionsService.getConnectedSessions(),
    ]);

    return {
      total,
      active: active.length,
      connected: connected.length,
      byStatus,
    };
  }
}
