import {
  Controller,
  Post,
  Body,
  Param,
  UseGuards,
  Logger,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { ServiceAuthGuard } from '@common/guards/service-auth.guard';
import { SessionManagerService } from './session-manager.service';
import { SessionsService } from './sessions.service';
import { UserCacheService } from '../../../features/users/user-cache.service';

interface SendMessageDto {
  phoneNumber: string;
  message: string;
}

interface SyncCategoriesDto {
  phoneNumber: string;
  userId: string;
}

/**
 * ExternalController
 * Endpoints externos para comunicação service-to-service
 *
 * Autenticação: ServiceAuthGuard (HMAC)
 * - Apenas gastocerto-api pode chamar
 * - Usado para enviar mensagens WhatsApp, obter dados, etc.
 */
@Controller('external')
@UseGuards(ServiceAuthGuard)
export class ExternalController {
  private readonly logger = new Logger(ExternalController.name);

  constructor(
    private readonly sessionManager: SessionManagerService,
    private readonly sessionsService: SessionsService,
    private readonly userCacheService: UserCacheService,
  ) {}

  /**
   * Envia mensagem WhatsApp para usuário ativo
   * POST /internal/send-message
   *
   * Body:
   * {
   *   "phoneNumber": "5511999999999",
   *   "message": "Sua transação foi confirmada!"
   * }
   */
  @Post('send-message')
  @HttpCode(HttpStatus.OK)
  async sendMessage(@Body() dto: SendMessageDto) {
    this.logger.log(`Sending message to ${dto.phoneNumber}`);

    // Busca sessão ativa para esse número
    const session = await this.sessionsService.getSessionByPhoneNumber(dto.phoneNumber);

    if (!session) {
      throw new NotFoundException(`No session found for phone: ${dto.phoneNumber}`);
    }

    const provider = this.sessionManager.getSession(session.sessionId);

    if (!provider) {
      throw new NotFoundException(`Session ${session.sessionId} is not active`);
    }

    // Formata JID do WhatsApp
    const jid = dto.phoneNumber.includes('@')
      ? dto.phoneNumber
      : `${dto.phoneNumber}@s.whatsapp.net`;

    const result = await provider.sendTextMessage(jid, dto.message);

    this.logger.log(`✅ Message sent to ${dto.phoneNumber}`);
    return result;
  }

  /**
   * Sincroniza categorias do usuário no RAG
   * POST /external/sync-categories
   * 
   * Chamado pela gastocerto-api quando:
   * - Usuário cria/edita/remove categoria
   * - Usuário muda conta padrão
   * 
   * Body:
   * {
   *   "phoneNumber": "5511999999999",
   *   "userId": "uuid-do-usuario"
   * }
   */
  @Post('sync-categories')
  @HttpCode(HttpStatus.OK)
  async syncCategories(@Body() dto: SyncCategoriesDto) {
    this.logger.log(`Sincronizando categorias do usuário ${dto.phoneNumber}`);

    try {
      // Sincronizar categorias no RAG
      await this.userCacheService.syncUserCategoriesToRAG(dto.phoneNumber);
      
      this.logger.log(`✅ Categorias sincronizadas com sucesso: ${dto.phoneNumber}`);
      
      return {
        success: true,
        message: 'Categorias sincronizadas com sucesso',
      };
    } catch (error) {
      this.logger.error(`Erro ao sincronizar categorias para ${dto.phoneNumber}:`, error);
      
      return {
        success: false,
        message: error.message || 'Erro ao sincronizar categorias',
        error: error.toString(),
      };
    }
  }
}
