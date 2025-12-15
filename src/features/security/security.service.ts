import { Injectable, Logger, Inject } from '@nestjs/common';
import { PrismaService } from '@core/database/prisma.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';

export interface ValidationResult {
  safe: boolean;
  reason?: string;
  severity?: 'low' | 'medium' | 'high';
}

/**
 * SecurityService
 *
 * Camada de segurança que deve ser chamada ANTES de qualquer processamento
 * Protege contra: prompt injection, rate limiting, mensagens maliciosas
 */
@Injectable()
export class SecurityService {
  private readonly logger = new Logger(SecurityService.name);

  // Padrões de prompt injection (atualizado 2025)
  private readonly INJECTION_PATTERNS = [
    // Comandos de sistema
    /ignore\s+(previous|above|all|prior|instructions|prompts)/gi,
    /forget\s+(everything|all|instructions|previous)/gi,
    /disregard\s+(previous|above|all)/gi,

    // Mudança de papel
    /you\s+are\s+(now|a|an)\s+(assistant|bot|ai|system)/gi,
    /act\s+as\s+(if|a|an)/gi,
    /pretend\s+(to\s+be|you\s+are)/gi,
    /roleplay\s+as/gi,

    // Instruções diretas
    /system\s*:/gi,
    /new\s+(role|instructions|rules|task|prompt)/gi,
    /override\s+(instructions|rules|settings)/gi,

    // Vazamento de prompt
    /show\s+(me\s+)?(your|the)\s+(prompt|instructions|system)/gi,
    /what\s+(are|is)\s+your\s+(instructions|rules|prompt)/gi,
    /repeat\s+(your|the)\s+(instructions|prompt)/gi,

    // Injeção de código
    /<script[^>]*>.*?<\/script>/gi,
    /javascript:/gi,
    /onerror\s*=/gi,
    /onclick\s*=/gi,

    // SQL Injection
    /DROP\s+TABLE/gi,
    /DELETE\s+FROM/gi,
    /UPDATE\s+.*\s+SET/gi,
    /INSERT\s+INTO/gi,
    /UNION\s+SELECT/gi,
    /;\s*DROP/gi,

    // Command Injection
    /&&\s*rm\s+-rf/gi,
    /\|\s*cat\s+/gi,
    /`.*`/g, // Backticks
    /\$\(.*\)/g, // Command substitution
  ];

  // Palavras suspeitas (contexto financeiro)
  private readonly SUSPICIOUS_WORDS = [
    'hack',
    'exploit',
    'bypass',
    'vulnerability',
    'injection',
    'malware',
    'virus',
    'trojan',
    'phishing',
    'scam',
  ];

  constructor(
    private prisma: PrismaService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  /**
   * ✨ MÉTODO PRINCIPAL
   * Valida mensagem do usuário (3 camadas)
   * Chamar ANTES de qualquer processamento
   */
  async validateUserMessage(
    phoneNumber: string,
    message: string,
    platform: 'whatsapp' | 'telegram' = 'whatsapp',
  ): Promise<ValidationResult> {
    // Buscar configurações (cache 5min)
    const settings = await this.getSecuritySettings();

    if (!settings.enabled) {
      return { safe: true }; // Segurança desabilitada
    }

    // 1️⃣ Validar tamanho
    if (message.length > settings.maxMessageLength) {
      await this.logSecurityEvent(phoneNumber, 'message_too_long', message, 'low');
      return {
        safe: false,
        reason: `Mensagem muito longa (máx ${settings.maxMessageLength} caracteres). Seja mais conciso.`,
        severity: 'low',
      };
    }

    // 2️⃣ Detectar prompt injection
    const injectionDetected = this.detectInjection(message);
    if (injectionDetected) {
      await this.logSecurityEvent(phoneNumber, 'injection_attempt', message, 'high');
      return {
        safe: false,
        reason: 'Desculpe, só posso processar transações financeiras. 🤖',
        severity: 'high',
      };
    }

    // 3️⃣ Detectar palavras suspeitas
    const suspiciousDetected = this.detectSuspiciousContent(message);
    if (suspiciousDetected) {
      await this.logSecurityEvent(phoneNumber, 'suspicious_content', message, 'medium');
      return {
        safe: false,
        reason: 'Mensagem contém conteúdo suspeito. Por favor, reformule.',
        severity: 'medium',
      };
    }

    // 4️⃣ Rate limiting
    const rateLimitOk = await this.checkRateLimit(phoneNumber, settings);
    if (!rateLimitOk) {
      await this.logSecurityEvent(phoneNumber, 'rate_limit_exceeded', message, 'medium');
      return {
        safe: false,
        reason: '⏰ Muitas mensagens em pouco tempo. Aguarde alguns segundos.',
        severity: 'medium',
      };
    }

    // ✅ Tudo OK
    return { safe: true };
  }

  /**
   * Detecta padrões de prompt injection
   */
  private detectInjection(message: string): boolean {
    const lowerMessage = message.toLowerCase();

    for (const pattern of this.INJECTION_PATTERNS) {
      if (pattern.test(message)) {
        this.logger.warn(`🚨 Injection pattern detected: ${pattern}`);
        return true;
      }
    }

    // Heurística: múltiplos comandos em sequência
    const commandCount = (message.match(/\n\n/g) || []).length;
    if (commandCount > 5) {
      this.logger.warn(`🚨 Too many line breaks (${commandCount})`);
      return true;
    }

    return false;
  }

  /**
   * Detecta conteúdo suspeito
   */
  private detectSuspiciousContent(message: string): boolean {
    const lowerMessage = message.toLowerCase();

    for (const word of this.SUSPICIOUS_WORDS) {
      if (lowerMessage.includes(word)) {
        this.logger.warn(`🚨 Suspicious word detected: ${word}`);
        return true;
      }
    }

    return false;
  }

  /**
   * Rate limiting com cache Redis
   */
  private async checkRateLimit(phoneNumber: string, settings: any): Promise<boolean> {
    const minuteKey = `rate:${phoneNumber}:minute`;
    const hourKey = `rate:${phoneNumber}:hour`;

    const [minuteCount, hourCount] = await Promise.all([
      this.cacheManager.get<number>(minuteKey),
      this.cacheManager.get<number>(hourKey),
    ]);

    // Verificar limites
    if (minuteCount && minuteCount >= settings.rateLimitMinute) {
      this.logger.warn(`🚨 Rate limit (minute): ${phoneNumber} - ${minuteCount} msgs`);
      return false;
    }

    if (hourCount && hourCount >= settings.rateLimitHour) {
      this.logger.warn(`🚨 Rate limit (hour): ${phoneNumber} - ${hourCount} msgs`);
      return false;
    }

    // Incrementar contadores
    await Promise.all([
      this.cacheManager.set(minuteKey, (minuteCount || 0) + 1, 60), // 1 minuto
      this.cacheManager.set(hourKey, (hourCount || 0) + 1, 3600), // 1 hora
    ]);

    return true;
  }

  /**
   * Sanitiza saída (remove caracteres perigosos)
   */
  sanitizeOutput(data: any): any {
    if (typeof data === 'string') {
      return data
        .replace(/[<>{}]/g, '') // Remove HTML/code chars
        .replace(/javascript:/gi, '')
        .replace(/onerror=/gi, '')
        .substring(0, 2000); // Limite de segurança
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.sanitizeOutput(item));
    }

    if (typeof data === 'object' && data !== null) {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(data)) {
        sanitized[key] = this.sanitizeOutput(value);
      }
      return sanitized;
    }

    return data;
  }

  /**
   * Buscar configurações de segurança (com cache)
   */
  async getSecuritySettings() {
    const cached = await this.cacheManager.get<any>('security:settings');
    if (cached) return cached;

    let settings = await this.prisma.aISettings.findFirst();

    if (!settings) {
      // Criar configuração padrão se não existir
      settings = await this.prisma.aISettings.create({
        data: {
          securityEnabled: true,
          securityMaxMessageLength: 500,
          securityRateLimitMinute: 20,
          securityRateLimitHour: 100,
          securityLogEvents: true,
        },
      });
    }

    const config = {
      enabled: settings.securityEnabled,
      maxMessageLength: settings.securityMaxMessageLength,
      rateLimitMinute: settings.securityRateLimitMinute,
      rateLimitHour: settings.securityRateLimitHour,
      logEvents: settings.securityLogEvents,
    };

    await this.cacheManager.set('security:settings', config, 300); // 5 minutos
    return config;
  }

  /**
   * Logar evento de segurança
   */
  private async logSecurityEvent(
    phoneNumber: string,
    eventType: string,
    details: string,
    severity: 'low' | 'medium' | 'high',
  ) {
    try {
      const settings = await this.getSecuritySettings();

      if (!settings.logEvents) return;

      // Buscar userId se existir
      const user = await this.prisma.userCache.findUnique({
        where: { phoneNumber },
        select: { id: true },
      });

      // Criar log leve (máx 500 chars)
      await this.prisma.securityLog.create({
        data: {
          userId: user?.id || 'unknown',
          eventType,
          details: details.substring(0, 500),
          severity,
        },
      });

      // Log interno
      const emoji = severity === 'high' ? '🔴' : severity === 'medium' ? '🟡' : '🟢';
      this.logger.warn(
        `${emoji} Security [${severity}]: ${eventType} - ${phoneNumber.substring(0, 6)}***`,
      );
    } catch (error) {
      this.logger.error('Failed to log security event', error);
    }
  }

  /**
   * Limpar logs antigos (chamar via cron)
   */
  async cleanOldLogs(daysToKeep: number = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = await this.prisma.securityLog.deleteMany({
      where: {
        createdAt: { lt: cutoffDate },
      },
    });

    this.logger.log(`🧹 Cleaned ${result.count} old security logs`);
    return result.count;
  }

  /**
   * Estatísticas de segurança (para dashboard)
   */
  async getSecurityStats(startDate?: Date, endDate?: Date) {
    const start = startDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 dias
    const end = endDate || new Date();

    const [totalEvents, byType, bySeverity, topUsers] = await Promise.all([
      // Total de eventos
      this.prisma.securityLog.count({
        where: {
          createdAt: { gte: start, lte: end },
        },
      }),

      // Por tipo
      this.prisma.securityLog.groupBy({
        by: ['eventType'],
        where: {
          createdAt: { gte: start, lte: end },
        },
        _count: true,
        orderBy: { _count: { eventType: 'desc' } },
        take: 10,
      }),

      // Por severidade
      this.prisma.securityLog.groupBy({
        by: ['severity'],
        where: {
          createdAt: { gte: start, lte: end },
        },
        _count: true,
      }),

      // Usuários com mais eventos
      this.prisma.securityLog.groupBy({
        by: ['userId'],
        where: {
          createdAt: { gte: start, lte: end },
        },
        _count: true,
        orderBy: { _count: { userId: 'desc' } },
        take: 10,
      }),
    ]);

    return {
      period: { start, end },
      totalEvents,
      byType: byType.map((t) => ({ type: t.eventType, count: t._count })),
      bySeverity: bySeverity.map((s) => ({ severity: s.severity, count: s._count })),
      topUsers: topUsers.map((u) => ({ userId: u.userId, count: u._count })),
    };
  }

  /**
   * Lista logs de segurança (paginado)
   */
  async getSecurityLogs(params: {
    skip?: number;
    take?: number;
    severity?: 'low' | 'medium' | 'high';
    eventType?: string;
    userId?: string;
  }) {
    return this.prisma.securityLog.findMany({
      where: {
        ...(params.severity && { severity: params.severity }),
        ...(params.eventType && { eventType: params.eventType }),
        ...(params.userId && { userId: params.userId }),
      },
      skip: params.skip || 0,
      take: params.take || 50,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Conta logs (para paginação)
   */
  async getSecurityLogsCount(params: {
    severity?: 'low' | 'medium' | 'high';
    eventType?: string;
    userId?: string;
  }) {
    return this.prisma.securityLog.count({
      where: {
        ...(params.severity && { severity: params.severity }),
        ...(params.eventType && { eventType: params.eventType }),
        ...(params.userId && { userId: params.userId }),
      },
    });
  }

  /**
   * Busca log específico
   */
  async getSecurityLog(id: string) {
    return this.prisma.securityLog.findUnique({
      where: { id },
    });
  }

  /**
   * Lista usuários bloqueados (rate limit ativo)
   */
  async getBlockedUsers(): Promise<
    Array<{ userId: string; minuteCount: number; hourCount: number }>
  > {
    // Buscar usuários com logs recentes de rate limit
    const recentBlocks = await this.prisma.securityLog.findMany({
      where: {
        eventType: 'rate_limit',
        createdAt: {
          gte: new Date(Date.now() - 60 * 60 * 1000), // última hora
        },
      },
      select: { userId: true },
      distinct: ['userId'],
    });

    const blockedUsers = [];

    for (const { userId } of recentBlocks) {
      const minuteKey = `rate_limit:minute:${userId}`;
      const hourKey = `rate_limit:hour:${userId}`;

      const [minuteCount, hourCount] = await Promise.all([
        this.cacheManager.get<number>(minuteKey),
        this.cacheManager.get<number>(hourKey),
      ]);

      if (minuteCount || hourCount) {
        blockedUsers.push({
          userId,
          minuteCount: minuteCount || 0,
          hourCount: hourCount || 0,
        });
      }
    }

    return blockedUsers;
  }

  /**
   * Desbloqueia usuário (limpa rate limit)
   */
  async unblockUser(phoneNumber: string): Promise<void> {
    const minuteKey = `rate_limit:minute:${phoneNumber}`;
    const hourKey = `rate_limit:hour:${phoneNumber}`;

    await Promise.all([
      this.cacheManager.del(minuteKey),
      this.cacheManager.del(hourKey),
    ]);

    this.logger.log(`✅ User ${phoneNumber} unblocked`);
  }

  /**
   * Atualiza configurações de segurança
   */
  async updateSecuritySettings(
    userId: string,
    settings: {
      securityEnabled?: boolean;
      securityMaxMessageLength?: number;
      securityRateLimitMinute?: number;
      securityRateLimitHour?: number;
      securityLogEvents?: boolean;
    },
  ) {
    // Buscar o primeiro registro de AISettings (configuração global)
    const currentSettings = await this.prisma.aISettings.findFirst();
    
    if (!currentSettings) {
      throw new Error('AI Settings not found');
    }

    const updated = await this.prisma.aISettings.update({
      where: { id: currentSettings.id },
      data: {
        ...settings,
        updatedAt: new Date(),
      },
    });

    // Limpar cache
    const cacheKey = `ai_settings:${userId}`;
    await this.cacheManager.del(cacheKey);

    return updated;
  }

  /**
   * Retorna padrões de injeção (para admin)
   */
  getInjectionPatterns(): RegExp[] {
    return this.INJECTION_PATTERNS;
  }
}
