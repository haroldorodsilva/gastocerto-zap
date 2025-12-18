import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { SecurityService } from './security.service';

/**
 * Controller para gestão de segurança via gastocerto-admin
 */
@Controller('api/security')
export class SecurityController {
  constructor(private securityService: SecurityService) {}

  /**
   * GET /api/security/stats
   * Dashboard de segurança
   */
  @Get('stats')
  async getStats(@Query('startDate') startDate?: string, @Query('endDate') endDate?: string) {
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;

    const stats = await this.securityService.getSecurityStats(start, end);

    return {
      success: true,
      data: stats,
    };
  }

  /**
   * GET /api/security/logs
   * Lista logs de segurança (paginado)
   */
  @Get('logs')
  async getLogs(
    @Query('page') page = 1,
    @Query('limit') limit = 50,
    @Query('severity') severity?: 'low' | 'medium' | 'high',
    @Query('eventType') eventType?: string,
    @Query('userId') userId?: string,
  ) {
    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    const [logs, total] = await Promise.all([
      this.securityService.getSecurityLogs({
        skip,
        take,
        severity,
        eventType,
        userId,
      }),
      this.securityService.getSecurityLogsCount({
        severity,
        eventType,
        userId,
      }),
    ]);

    return {
      success: true,
      data: logs,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    };
  }

  /**
   * GET /api/security/logs/:id
   * Detalhe de log específico
   */
  @Get('logs/:id')
  async getLog(@Param('id') id: string) {
    const log = await this.securityService.getSecurityLog(id);

    if (!log) {
      return {
        success: false,
        error: 'Log not found',
      };
    }

    return {
      success: true,
      data: log,
    };
  }

  /**
   * GET /api/security/blocked-users
   * Lista usuários bloqueados por rate limit
   */
  @Get('blocked-users')
  async getBlockedUsers() {
    const blockedUsers = await this.securityService.getBlockedUsers();

    return {
      success: true,
      data: blockedUsers,
    };
  }

  /**
   * POST /api/security/unblock/:phone
   * Desbloqueia usuário (limpa rate limit)
   */
  @Post('unblock/:phone')
  @HttpCode(HttpStatus.OK)
  async unblockUser(@Param('phone') phone: string) {
    await this.securityService.unblockUser(phone);

    return {
      success: true,
      message: `User ${phone} unblocked successfully`,
    };
  }

  /**
   * GET /api/security/settings/:userId
   * Busca configurações de segurança
   */
  @Get('settings/:userId')
  async getSettings(@Param('userId') userId: string) {
    const settings = await this.securityService.getSecuritySettings();

    return {
      success: true,
      data: settings,
    };
  }

  /**
   * PATCH /api/security/settings/:userId
   * Atualiza configurações de segurança
   */
  @Patch('settings/:userId')
  async updateSettings(
    @Param('userId') userId: string,
    @Body()
    body: {
      securityEnabled?: boolean;
      securityMaxMessageLength?: number;
      securityRateLimitMinute?: number;
      securityRateLimitHour?: number;
      securityLogEvents?: boolean;
    },
  ) {
    const settings = await this.securityService.updateSecuritySettings(userId, body);

    return {
      success: true,
      data: settings,
      message: 'Security settings updated successfully',
    };
  }

  /**
   * POST /api/security/test
   * Testa validação de mensagem (debug)
   */
  @Post('test')
  @HttpCode(HttpStatus.OK)
  async testValidation(@Body() body: { message: string; userId: string }) {
    const result = await this.securityService.validateUserMessage(body.userId, body.message);

    return {
      success: true,
      data: result,
    };
  }

  /**
   * POST /api/security/clean-old-logs
   * Limpa logs antigos (> 30 dias)
   */
  @Post('clean-old-logs')
  @HttpCode(HttpStatus.OK)
  async cleanOldLogs() {
    const deleted = await this.securityService.cleanOldLogs();

    return {
      success: true,
      message: `Cleaned ${deleted} old logs`,
      deleted,
    };
  }

  /**
   * GET /api/security/injection-patterns
   * Lista padrões de injeção detectados
   */
  @Get('injection-patterns')
  async getInjectionPatterns() {
    const patterns = this.securityService.getInjectionPatterns();

    return {
      success: true,
      data: {
        patterns: patterns.map((p) => ({
          pattern: p.source,
          description: this.getPatternDescription(p.source),
        })),
        total: patterns.length,
      },
    };
  }

  /**
   * Helper: Descrição dos padrões
   */
  private getPatternDescription(pattern: string): string {
    const descriptions: Record<string, string> = {
      'ignore.*previous.*instructions': 'Ignora instruções anteriores',
      'forget.*previous.*context': 'Esquece contexto anterior',
      'you.*are.*now': 'Tenta redefinir identidade',
      'new.*instructions': 'Injeta novas instruções',
      'system.*prompt': 'Acessa prompt do sistema',
      'override.*settings': 'Tenta sobrescrever configurações',
      'admin.*mode': 'Solicita modo admin',
      'developer.*mode': 'Solicita modo desenvolvedor',
    };

    for (const [key, desc] of Object.entries(descriptions)) {
      if (pattern.includes(key)) return desc;
    }

    return 'Padrão de injeção detectado';
  }
}
